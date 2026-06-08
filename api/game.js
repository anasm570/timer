import { kv } from '@vercel/kv';

function randomTarget() {
    return Math.random() * 8 + 3; // 3.0 - 11.0
}

function newGameState(roomId) {
    return {
        players: [
            { score: 0, attempt: null, hasPlayed: false },
            { score: 0, attempt: null, hasPlayed: false }
        ],
        currentTurn: 0,
        target: randomTarget(),
        active: true,
        timerRunning: false,
        elapsed: 0,
        createdAt: Date.now()
    };
}

function endRoundIfNeeded(state) {
    if (state.players[0].hasPlayed && state.players[1].hasPlayed) {
        state.active = false;
        state.timerRunning = false;
        const diff1 = Math.abs(state.players[0].attempt - state.target);
        const diff2 = Math.abs(state.players[1].attempt - state.target);
        if (diff1 < diff2) state.players[0].score++;
        else if (diff2 < diff1) state.players[1].score++;
        return true;
    }
    return false;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { action, roomId, stopTime } = req.body;
    
    try {
        switch (action) {
            case 'create': {
                const { roomId: rid } = req.body;
                if (!rid) return res.status(400).json({ error: 'roomId مطلوب' });
                const existing = await kv.get(`room:${rid}`);
                if (existing) {
                    return res.json({ success: false, error: 'الغرفة موجودة بالفعل' });
                }
                const newRoom = newGameState(rid);
                // نضع الغرفة مع صلاحية ساعة واحدة (3600 ثانية)
                await kv.set(`room:${rid}`, newRoom, { ex: 3600 });
                return res.json({ success: true });
            }
            
            case 'join': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) {
                    return res.json({ success: false, error: 'الغرفة غير موجودة' });
                }
                // لا نعدل الحالة، فقط نسمح بالدخول
                return res.json({ success: true });
            }
            
            case 'get': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) {
                    return res.json({ success: false, error: 'الغرفة غير موجودة' });
                }
                // تجديد صلاحية الغرفة كل مرة تُطلب فيها (تمنع انتهاءها أثناء اللعب)
                await kv.expire(`room:${roomId}`, 3600);
                return res.json({ success: true, state: {
                    players: state.players,
                    currentTurn: state.currentTurn,
                    target: state.target,
                    active: state.active,
                    timerRunning: state.timerRunning,
                    elapsed: state.elapsed
                } });
            }
            
            case 'start': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (!state.active) return res.json({ success: false, error: 'الجولة انتهت' });
                if (state.players[state.currentTurn].hasPlayed) return res.json({ success: false, error: 'لعبت مسبقاً' });
                if (state.timerRunning) return res.json({ success: false, error: 'التايمر يعمل بالفعل' });
                state.timerRunning = true;
                state.elapsed = 0;
                await kv.set(`room:${roomId}`, state, { ex: 3600 });
                return res.json({ success: true });
            }
            
            case 'stop': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (!state.timerRunning) return res.json({ success: false, error: 'التايمر لا يعمل' });
                if (state.players[state.currentTurn].hasPlayed) return res.json({ success: false, error: 'لعبت مسبقاً' });
                state.timerRunning = false;
                state.players[state.currentTurn].attempt = stopTime;
                state.players[state.currentTurn].hasPlayed = true;
                const ended = endRoundIfNeeded(state);
                if (!ended) {
                    state.currentTurn = state.currentTurn === 0 ? 1 : 0;
                }
                await kv.set(`room:${roomId}`, state, { ex: 3600 });
                return res.json({ success: true });
            }
            
            case 'reset': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                state.active = true;
                state.currentTurn = 0;
                state.players[0].attempt = null;
                state.players[0].hasPlayed = false;
                state.players[1].attempt = null;
                state.players[1].hasPlayed = false;
                state.timerRunning = false;
                state.elapsed = 0;
                await kv.set(`room:${roomId}`, state, { ex: 3600 });
                return res.json({ success: true });
            }
            
            case 'next': {
                const state = await kv.get(`room:${roomId}`);
                if (!state) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (state.active) return res.json({ success: false, error: 'أنهِ الجولة الحالية أولاً' });
                state.active = true;
                state.currentTurn = 0;
                state.players[0].attempt = null;
                state.players[0].hasPlayed = false;
                state.players[1].attempt = null;
                state.players[1].hasPlayed = false;
                state.target = randomTarget();
                state.timerRunning = false;
                state.elapsed = 0;
                await kv.set(`room:${roomId}`, state, { ex: 3600 });
                return res.json({ success: true });
            }
            
            default:
                return res.status(400).json({ error: 'إجراء غير معروف' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
                    }

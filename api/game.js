import { kv } from '@vercel/kv';

function randomTarget() { return Math.random() * 8 + 3; }

function newGameState(roomId) {
    return {
        players: [{ score: 0, attempt: null, hasPlayed: false }, { score: 0, attempt: null, hasPlayed: false }],
        currentTurn: 0,
        target: randomTarget(),
        active: true,
        timerRunning: false,
        elapsed: 0,
        createdAt: Date.now()
    };
}

async function getRoom(roomId) {
    const key = `room:${roomId}`;
    let room = await kv.get(key);
    if (!room) return null;
    // إذا مرت أكثر من ساعة دون نشاط، نعتبر الغرفة منتهية
    if (Date.now() - room.createdAt > 3600000) {
        await kv.del(key);
        return null;
    }
    return room;
}

async function saveRoom(roomId, state) {
    const key = `room:${roomId}`;
    await kv.set(key, state);
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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action, roomId, stopTime } = req.body;

    try {
        switch (action) {
            case 'create': {
                const existing = await kv.get(`room:${roomId}`);
                if (existing) return res.json({ success: false, error: 'الغرفة موجودة بالفعل' });
                const newRoom = newGameState(roomId);
                await saveRoom(roomId, newRoom);
                return res.json({ success: true });
            }
            case 'join': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                // لا نحتاج لتعديل الحالة هنا، فقط نسمح بالانضمام
                return res.json({ success: true });
            }
            case 'get': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                return res.json({ success: true, state: {
                    players: room.players,
                    currentTurn: room.currentTurn,
                    target: room.target,
                    active: room.active,
                    timerRunning: room.timerRunning,
                    elapsed: room.elapsed
                } });
            }
            case 'start': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (!room.active) return res.json({ success: false, error: 'الجولة انتهت' });
                if (room.players[room.currentTurn].hasPlayed) return res.json({ success: false, error: 'لعبت مسبقاً' });
                if (room.timerRunning) return res.json({ success: false, error: 'التايمر يعمل' });
                room.timerRunning = true;
                room.elapsed = 0;
                await saveRoom(roomId, room);
                return res.json({ success: true });
            }
            case 'stop': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (!room.timerRunning) return res.json({ success: false, error: 'التايمر لا يعمل' });
                if (room.players[room.currentTurn].hasPlayed) return res.json({ success: false, error: 'لعبت مسبقاً' });
                room.timerRunning = false;
                room.players[room.currentTurn].attempt = stopTime;
                room.players[room.currentTurn].hasPlayed = true;
                const ended = endRoundIfNeeded(room);
                if (!ended) room.currentTurn = room.currentTurn === 0 ? 1 : 0;
                await saveRoom(roomId, room);
                return res.json({ success: true });
            }
            case 'reset': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                room.active = true;
                room.currentTurn = 0;
                room.players[0].attempt = null; room.players[0].hasPlayed = false;
                room.players[1].attempt = null; room.players[1].hasPlayed = false;
                room.timerRunning = false;
                room.elapsed = 0;
                await saveRoom(roomId, room);
                return res.json({ success: true });
            }
            case 'next': {
                const room = await getRoom(roomId);
                if (!room) return res.json({ success: false, error: 'الغرفة غير موجودة' });
                if (room.active) return res.json({ success: false, error: 'أنهِ الجولة الحالية أولاً' });
                room.active = true;
                room.currentTurn = 0;
                room.players[0].attempt = null; room.players[0].hasPlayed = false;
                room.players[1].attempt = null; room.players[1].hasPlayed = false;
                room.target = randomTarget();
                room.timerRunning = false;
                room.elapsed = 0;
                await saveRoom(roomId, room);
                return res.json({ success: true });
            }
            default: return res.status(400).json({ error: 'إجراء غير معروف' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'خطأ في الخادم' });
    }
}

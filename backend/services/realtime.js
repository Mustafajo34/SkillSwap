// App-wide live updates over the Socket.IO server that signaling.js creates.
// Every signed-in socket joins a private room for its user, so routes can
// push events to one person on all their open tabs and devices.

let io = null;

const userRoom = (userId) => `user:${userId}`;

function setRealtimeServer(server) {
  io = server;
}

// Fire-and-forget: a user with no open tabs simply doesn't get the event
function emitToUser(userId, event, payload) {
  io?.to(userRoom(String(userId))).emit(event, payload);
}

// To everyone connected (e.g. the shared message board)
function emitToAll(event, payload) {
  io?.emit(event, payload);
}

// Who is connected to which video room right now (set by signaling.js), so
// routes can tell whether someone is actually in a live session
let presence = () => false;
function setRoomPresence(fn) {
  presence = fn;
}
const isInRoom = (roomId, userId) => presence(String(roomId), String(userId));

module.exports = { setRealtimeServer, emitToUser, emitToAll, userRoom, setRoomPresence, isInRoom };

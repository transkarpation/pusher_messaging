/** Current Pusher socket id, attached to API calls so the server doesn't echo our own events. */
let socketId: string | undefined;

export const getSocketId = () => socketId;
export const setSocketId = (id: string | undefined) => {
  socketId = id;
};

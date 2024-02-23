// always suggest for typescript
import http from "http";
import { Server } from "socket.io";
import app from "./app";

import mongoose from "mongoose";
import subscribeToEvents from "./app/events";
import config from "./config";

const PORT: number = 5000;
export let server = http.createServer(app);


export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});


io.on("connection", (socket) => {
  // get the user's id


  const userId = socket.handshake.query.userId;

  // Log a message
  console.log(`User ${userId} connected`);

  // Join the user to the room
  socket.join(userId);


  socket.on("disconnect", () => {
    console.log(`User ${userId} disconnected`);
  });

});


async function bootstrap() {
  try{

    subscribeToEvents();


    server = app.listen(PORT, async () => {
      console.log(`listening on port ${PORT}`);
     const db = await mongoose.connect(config.mongoUrl);
      console.log('database connected',db.connection.readyState);
      console.log('application setup completed successfully');
      console.log('application started', new Date().toTimeString());
    });
  } catch (error) {
    console.error('Error connecting to Redis', error);
  }
}

bootstrap();



const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const crypto = require("crypto");
const secret = crypto.randomBytes(64).toString("hex");
const app = express();
app.use(bodyParser.json());
app.use(
  session({
    secret: secret,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 30 * 60 * 1000 }, // session expires after 30 minutes
  })
);
const uri =
  "mongodb+srv://kumaraguru818:yhujik123@locations.3wjfclo.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);
const server = http.createServer(app);
// create a new instance of the Socket.IO server
const io = new Server(server);

io.on("connection", (socket) => {
  socket.on("addMarker", async (marker) => {
    try {
      socket.emit("log", "Connecting to MongoDB database");
      await client.connect();
      socket.emit("log", "Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");
      socket.emit(
        "log",
        `Inserting marker into database: ${JSON.stringify(marker)}`
      );
      const result = await collection.insertOne(marker);
      socket.emit("log", "Inserted marker into database");
      io.emit("newMarker", { ...marker });
    } catch (e) {
      console.error(e);
    } finally {
      await client.close();
    }
  });
});

// app.post("/insertData", async (req, res) => {
//   const { latitude, longitude, type } = req.body;

//   try {
//     await client.connect();

//     const database = client.db("FOMO");
//     const collection = database.collection("locations");

//     await collection.insertOne({ latitude, longitude, type });

//     res.json({ success: true });
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ success: false });
//   } finally {
//     await client.close();
//   }
// });

app.post("/insertUser", async (req, res) => {
  const { username, password } = req.body;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");
    const hash = await bcrypt.hash(password, 10);
    console.log("yes");
    await collection.insertOne({ username, hash });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  } finally {
    await client.close();
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");
    const user = await collection.findOne({ username });

    if (!user) {
      res
        .status(401)
        .json({ success: false, message: "Invalid username or password" });
      return;
    }

    const match = await bcrypt.compare(password, user.hash);
    if (!match) {
      res
        .status(401)
        .json({ success: false, message: "Invalid username or password" });
      return;
    }
    req.session.userId = user.username;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  } finally {
    await client.close();
  }
});

app.get("/getAllLocations", async (req, res) => {
  // check if the user is authenticated
  if (!req.session.userId) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return;
  }

  try {
    await client.connect();
    const database = client.db("FOMO");
    const collection = database.collection("locations");
    const locations = await collection.find({}).toArray();
    res.json(locations);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  } finally {
    await client.close();
  }
});
server.listen(process.env.PORT || 3000, () => {
  console.log("Server listening on port 3000");
});

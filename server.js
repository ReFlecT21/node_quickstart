const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const { ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const crypto = require("crypto");
const secret = crypto.randomBytes(64).toString("hex");
const cron = require("node-cron");
const app = express();
app.use(bodyParser.json());

const uri =
  "mongodb+srv://kumaraguru818:yhujik123@locations.3wjfclo.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);
let changeStream;
const server = http.createServer(app);
// create a new instance of the Socket.IO server
const io = new Server(server);
app.use(
  session({
    secret: secret,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: uri }),
  })
);

async function createTTLIndex() {
  try {
    await client.connect();
    const database = client.db("FOMO");
    const collection = database.collection("locations");
    await collection.dropIndex("createdAt_1");
    // Create a TTL index on the createdAt field with an expiration time of 5 minutes
    await collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 5 * 60 }
    );
  } catch (e) {
    console.error(e);
  }
}

createTTLIndex();

async function watchCollection() {
  try {
    await client.connect();
    const database = client.db("FOMO");
    const collection = database.collection("locations");

    // Watch for changes in the locations collection
    changeStream = collection.watch();
    changeStream.on("change", (change) => {
      if (change.operationType === "delete") {
        const markerId = change.documentKey._id;
        io.emit("markerRemoved", markerId);
      }
    });
  } catch (e) {
    console.error(e);
  }
}

watchCollection();
io.on("connection", (socket) => {
  socket.on("addMarker", async (marker) => {
    try {
      socket.emit("log", "Connecting to MongoDB database");
      await client.connect();
      socket.emit("log", "Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");

      marker.createdAt = new Date();
      socket.emit(
        "log",
        `Inserting marker into database: ${JSON.stringify(marker)}`
      );
      const result = await collection.insertOne(marker);
      socket.emit("log", "Inserted marker into database");
      io.emit("newMarker", { ...marker });
    } catch (e) {
      console.error(e);
    }
  });
});

io.on("connection", (socket) => {
  socket.on("removeMarker", async (markerId) => {
    try {
      socket.emit("log", "Connecting to MongoDB database");
      await client.connect();
      socket.emit("log", "Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");
      socket.emit("log", `Removing marker with ID ${markerId} from database`);
      const result = await collection.deleteOne({
        _id: new ObjectId(markerId),
      });
      socket.emit("log", "Removed marker from database");
      io.emit("markerRemoved", markerId);
    } catch (e) {
      console.error(e);
    }
  });
});
app.get("/checkAuth", (req, res) => {
  if (req.session.userId) {
    // user is authenticated
    res.json({ success: true });
  } else {
    // user is not authenticated
    res.status(401).json({ success: false });
  }
});

app.get("/clearSessions", (req, res) => {
  req.sessionStore.clear((err) => {
    if (err) {
      console.error(err);
      res.status(500).json({ success: false });
    } else {
      res.json({ success: true });
    }
  });
});

app.post("/insertUser", async (req, res) => {
  const { username, password } = req.body;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");

    // check if the username already exists in the database
    const existingUser = await collection.findOne({ username });
    if (existingUser) {
      res
        .status(400)
        .json({ success: false, message: "This username already exists" });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    console.log("yes");
    await collection.insertOne({ username, hash });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
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
  }
});

app.get("/getAllLocations", async (req, res) => {
  try {
    await client.connect();
    const database = client.db("FOMO");
    const collection = database.collection("locations");
    const locations = await collection.find({}).toArray();
    res.json(locations);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});
server.listen(process.env.PORT || 3000, () => {
  console.log("Server listening on port 3000");
});

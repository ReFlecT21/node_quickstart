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
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 365 * 100, // 100 years
    },
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
      { expireAfterSeconds: 5 * 24 * 60 * 60 }
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
  socket.on("updateMarker", async (marker) => {
    try {
      socket.emit("log", "Connecting to MongoDB database");
      await client.connect();
      socket.emit("log", "Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");

      socket.emit(
        "log",
        `Updating marker in database: ${JSON.stringify(marker)}`
      );
      const result = await collection.updateOne(
        { _id: marker._id },
        { $set: { createdAt: new Date() } }
      );
      socket.emit("log", "Updated marker in database");
      io.emit("updatedMarker", { ...marker, createdAt: new Date() });
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
    await collection.insertOne({
      username,
      hash,
      points: 0,
      joinedDate: new Date(),
      NoOfMarkers: 0,
      NoOfContributions: 0,
    });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

app.get("/getJoinedYear/:username", async (req, res) => {
  const { username } = req.params;
  try {
    await client.connect();
    const database = client.db("FOMO");
    const collection = database.collection("userinfo");
    const user = await collection.findOne({ username });
    if (user) {
      const joinedYear = user.joinedDate.getFullYear();
      res.json({ success: true, joinedYear });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
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
io.on("connection", (socket) => {
  socket.on("incrementUserPoints", async (username) => {
    try {
      await client.connect();

      const database = client.db("FOMO");
      const collection = database.collection("userinfo");

      // increment the points field of the user with the specified username
      const result = await collection.findOneAndUpdate(
        { username: username },
        { $inc: { points: 1 } },
        { returnDocument: "after" }
      );

      const points = result.value.points;
      io.emit("incrementUserPointsSuccess", points);
    } catch (e) {
      console.error(e);
      io.emit("incrementUserPointsError");
    }
  });
});

app.get("/getPoints/:username", async (req, res) => {
  const { username } = req.params;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");

    // find the user with the given username
    const user = await collection.findOne({ username });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    // retrieve the points field
    const points = user.points;
    res.json({ success: true, points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

io.on("connection", (socket) => {
  socket.on("incrementUserMarkers", async (username) => {
    try {
      await client.connect();

      const database = client.db("FOMO");
      const collection = database.collection("userinfo");

      // increment the NoOfMarkers field of the user with the specified username
      const result = await collection.findOneAndUpdate(
        { username: username },
        { $inc: { NoOfMarkers: 1 } },
        { returnDocument: "after" }
      );

      const noOfMarkers = result.value.NoOfMarkers;
      socket.emit("incrementUserMarkersSuccess", noOfMarkers);
    } catch (e) {
      console.error(e);
      socket.emit("incrementUserMarkersError");
    }
  });
});

app.get("/getNoOfMarkers/:username", async (req, res) => {
  const { username } = req.params;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");

    // find the user with the given username
    const user = await collection.findOne({ username });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    // retrieve the NoOfMarkers field
    const noOfMarkers = user.NoOfMarkers;
    res.json({ success: true, noOfMarkers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});
io.on("connection", (socket) => {
  socket.on("decrementUserMarkers", async (username) => {
    try {
      await client.connect();

      const database = client.db("FOMO");
      const collection = database.collection("userinfo");

      // increment the NoOfMarkers field of the user with the specified username
      const result = await collection.findOneAndUpdate(
        { username: username },
        { $inc: { NoOfMarkers: -1 } },
        { returnDocument: "after" }
      );

      const noOfMarkers = result.value.NoOfMarkers;
      socket.emit("decrementUserMarkersSuccess", noOfMarkers);
    } catch (e) {
      console.error(e);
      socket.emit("incrementUserMarkersError");
    }
  });
});
io.on("connection", (socket) => {
  socket.on("incrementUserContributions", async (username) => {
    try {
      await client.connect();

      const database = client.db("FOMO");
      const collection = database.collection("userinfo");

      // increment the NoOfMarkers field of the user with the specified username
      const result = await collection.findOneAndUpdate(
        { username: username },
        { $inc: { NoOfContributions: 1 } },
        { returnDocument: "after" }
      );

      const NoOfContributions = result.value.NoOfContributions;
      socket.emit("incrementUserContributionsSuccess", NoOfContributions);
    } catch (e) {
      console.error(e);
      socket.emit("incrementUserMarkersError");
    }
  });
});

app.get("/getNoOfContributions/:username", async (req, res) => {
  const { username } = req.params;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("userinfo");

    // find the user with the given username
    const user = await collection.findOne({ username });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    // retrieve the NoOfContributions field
    const NoOfContributions = user.NoOfContributions;
    res.json({ success: true, NoOfContributions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server listening on port 3000");
});

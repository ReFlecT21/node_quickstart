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
require("dotenv").config();
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const secret = crypto.randomBytes(64).toString("hex");
const cron = require("node-cron");
const app = express();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
app.use(bodyParser.json());
const multer = require("multer");
const AWS = require("aws-sdk");

// Replace with your own AWS credentials and S3 bucket name
const awsConfig = {
  region: "ap-southeast-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucketName: "fomos3",
};
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "access.log"),
  { flags: "a" }
);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
app.use(morgan("combined", { stream: accessLogStream }));
// Configure AWS
AWS.config.update(awsConfig);
const s3 = new AWS.S3();

// Define the POST endpoint for uploading the image
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }

  const imageContent = req.file.buffer;
  const fileName = req.file.originalname;

  const params = {
    Bucket: awsConfig.bucketName,
    Key: fileName,
    Body: imageContent,
  };

  // Upload the image to S3
  s3.upload(params, async (err, data) => {
    if (err) {
      console.error("Error uploading image:", err);
      return res.status(500).json({ error: "Failed to upload image to S3" });
    }

    // The image was successfully uploaded to S3
    // The S3 URL of the image is available in the 'Location' property of 'data'
    const imageUrl = data.Location;
    console.log("Image uploaded to:", imageUrl);

    // Store the image URL in your MongoDB database
    try {
      // Connect to your MongoDB database
      await client.connect();
      // Get a reference to your database
      const db = client.db("FOMO");
      // Get a reference to your collection
      const collection = db.collection("locations");
      // Insert a new document with the image URL
      await collection.insertOne({ imageUrl });
      console.log("Image URL stored in database");
    } catch (error) {
      console.error("Error storing image URL in database:", error);
    } finally {
      await client.close();
    }

    res.status(200).json({ imageUrl });
  });
});

let changeStream;
const server = http.createServer(app);
// create a new instance of the Socket.IO server
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 100 MB
});
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
// io.on("connection", (socket) => {
//   socket.on("addMarker", async (marker) => {
//     try {
//       socket.emit("log", "Connecting to MongoDB database");
//       await client.connect();
//       socket.emit("log", "Connected to MongoDB database");
//       const database = client.db("FOMO");
//       const collection = database.collection("locations");

//       marker.createdAt = new Date();
//       socket.emit(
//         "log",
//         `Inserting marker into database: ${JSON.stringify(marker)}`
//       );
//       const result = await collection.insertOne(marker);
//       socket.emit("log", "Inserted marker into database");
//       io.emit("newMarker", { ...marker });
//     } catch (e) {
//       console.error(e);
//     }
//   });
// });
io.on("connection", (socket) => {
  socket.on("addMarker", async (data) => {
    try {
      const { marker, imageContent, fileName } = data;
      socket.emit("log", "uploading to s3...");
      // Upload the image to S3
      const params = {
        Bucket: awsConfig.bucketName,
        Key: fileName,
        Body: imageContent,
      };

      let imageUrl;
      try {
        const uploadResult = await s3.upload(params).promise();
        imageUrl = uploadResult.Location;
        console.log("Image uploaded to:", imageUrl);
      } catch (err) {
        console.error("Error uploading image:", err);
        socket.emit("uploadError", "Failed to upload image to S3");
        return;
      }

      // Store the marker and image URL in your MongoDB database
      socket.emit("log", "Connecting to MongoDB database");
      await client.connect();
      socket.emit("log", "Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");

      marker.createdAt = new Date();
      marker.imageUrl = imageUrl;
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
  socket.on("updateMarker", async (marker, username) => {
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
        { _id: new ObjectId(marker._id) },
        { $set: { verify: username, verificationDate: new Date() } }
      );
      socket.emit("log", "Updated marker in database");
      io.emit("updatedMarker", {
        ...marker,
        verify: username,
        verificationDate: new Date(),
      });
    } catch (e) {
      console.error(e);
    }
  });
});

app.get("/getMarkers", async (req, res) => {
  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("locations");

    // Find all markers in the collection
    const markers = await collection
      .find({})
      .project({ verificationDate: 1, verify: 1 })
      .toArray();

    res.json({ success: true, markers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
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
  req.session.destroy((err) => {
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

    app.post("/incrementTotalRatings", async (req, res) => {
      const { markerID, number } = req.body;

      try {
        await client.connect();

        const database = client.db("FOMO");
        const collection = database.collection("locations");

        // increment the totalratings field of the specified markerid
        const result = await collection.updateOne(
          { _id: new ObjectId(markerID) },
          { $inc: { totalratings: number } }
        );

        if (result.modifiedCount === 1) {
          res.json({ success: true });
        } else {
          res.status(400).json({ success: false, message: "Marker not found" });
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
      } finally {
        await client.close();
      }
    });

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

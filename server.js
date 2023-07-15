const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
app.use(bodyParser.json());

const uri =
  "mongodb+srv://kumaraguru818:yhujik123@locations.3wjfclo.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

// create a new instance of the Socket.IO server
const io = new Server();

io.on("connection", (socket) => {
  socket.on("addMarker", async (marker) => {
    try {
      console.log("Connecting to MongoDB database");
      await client.connect();
      console.log("Connected to MongoDB database");
      const database = client.db("FOMO");
      const collection = database.collection("locations");
      console.log("Inserting marker into database:", marker);
      await collection.insertOne(marker);
      console.log("Inserted marker into database");
      io.emit("newMarker", marker);
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

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  } finally {
    await client.close();
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
  } finally {
    await client.close();
  }
});
app.listen(process.env.PORT || 3000, () => {
  console.log("Server listening on port 3000");
});

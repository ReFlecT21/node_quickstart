const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const app = express();
app.use(bodyParser.json());

const uri =
  "mongodb+srv://kumaraguru818:yhujik123@locations.3wjfclo.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

app.post("/insertData", async (req, res) => {
  const { latitude, longitude } = req.body;

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("locations");

    await collection.insertOne({ latitude, longitude });

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

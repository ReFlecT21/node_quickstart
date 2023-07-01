const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const app = express();
app.use(bodyParser.json());

const uri =
  "mongodb+srv://kumaraguru818:yhujik123@locations.3wjfclo.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

app.post("/insertData", async (req, res) => {
  //   const { latitude, longitude } = req.body;
  const recipes = [
    {
      latitude: 6.548,
      longitude: 20.232,
    },
    {
      latitude: 15.321,
      longitude: 45.232,
    },
  ];

  try {
    await client.connect();

    const database = client.db("FOMO");
    const collection = database.collection("locations");

    await collection.insertMany(recipes);

    res.json({ success: true });
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

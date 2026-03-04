const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const client = new MongoClient(uri);

let db;

async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.MONGODB_DB || "odevteslim");
    console.log("MongoDB bağlandı ✅");
  }
  return db;
}

module.exports = connectDB;
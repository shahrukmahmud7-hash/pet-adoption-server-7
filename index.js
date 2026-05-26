const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();
const app = express();
const cors = require("cors");

const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("petdb");
    const petCollection = db.collection("pets");
    const session = db.collection("session");
    const userCollection = db.collection("user");
    const adoptionCollection = db.collection("adoption");

    const verifyAuth = async (req, res, next) => {
      const auth = req.headers.authorization;

      if (!auth) {
        return res.status(401).send({ error: "unauthorized access" });
      }

      const token = auth.split(" ")[1];
      const result = await session.findOne({ token });

      if (!result) {
        return res.status(401).send({ error: "unauthorized access" });
      }

      const user = await userCollection.findOne({
        _id: new ObjectId(result.userId),
      });

      if (!user) {
        return res.status(401).send({ error: "unauthorized access" });
      }

      req.user = user;

      next();
    };

    app.get("/pets", async (req, res) => {
      try {
        const { search, species, sort, limit } = req.query;

        const query = {};

        // Search by pet name 
        if (search) {
          query.petName = {
            $regex: search,
            $options: "i",
          };
        }

        // Filter by species
        if (species) {
          query.species = {
            $in: species.split(","),
          };
        }

        // Sorting
        let sortOption = {};
        if (sort === "low") {
          sortOption.adoptionFee = 1;
        } else if (sort === "high") {
          sortOption.adoptionFee = -1;
        }

        let dbQuery = petCollection.find(query).sort(sortOption);

        // Apply limit only if valid
        if (limit) {
          const limitNumber = parseInt(limit);
          if (!isNaN(limitNumber)) {
            dbQuery = dbQuery.limit(limitNumber);
          }
        }

        const result = await dbQuery.toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/pet/:id", async (req, res) => {
      const { id } = req.params;
      const result = await petCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.post("/pet", async (req, res) => {
      const petData = req.body;
      const result = await petCollection.insertOne({
        ...petData,
        status: "Available",
      });
      res.send(result);
    });
    app.delete("/pet/:id", async (req, res) => {
      const { id } = req.params;
      const result = await petCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch("/edit/:id", async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      const result = await petCollection.updateOne(
        {
          _id: new ObjectId(id),
        },
        { $set: updateData },
      );
      res.send(result);
    });

    app.get("/my-listing", verifyAuth, async (req, res) => {
      const user = req.user;

      const result = await petCollection
        .find({
          ownerEmail: user.email,
        })
        .limit(8)
        .toArray();
      res.send(result);
    });

    app.post("/request-adopt", verifyAuth, async (req, res) => {
      const user = req.user;

      const isAlreadyRequested = await adoptionCollection.findOne({
        petId: req.body.petId,
        userEmail: req.body?.userEmail,
      });

      if (isAlreadyRequested) {
        return res.status(400).send({ message: "already requested" });
      }

      const result = await adoptionCollection.insertOne(req.body);
      res.send(result);
    });

    // get request
    app.get("/request/:petId", async (req, res) => {
      const petId = req.params.petId;
      const result = await adoptionCollection.find({ petId }).toArray();
      res.send(result);
    });

    // request update
    app.patch("/request-update/:id", verifyAuth, async (req, res) => {
      const { id } = req.params;
      const { status, userEmail } = req.body;

      const result = await adoptionCollection.updateOne(
        {
          petId: id,
          userEmail,
        },
        { $set: { status } },
      );

      await adoptionCollection.updateMany(
        {
          petId: id,
          userEmail: { $ne: userEmail },
        },
        { $set: { status: "Rejected" } },
      );

      if (status === "Approved") {
        await petCollection.updateOne(
          {
            _id: new ObjectId(id),
          },
          { $set: { status: "Adopted" } },
        );
      }

      res.send(result);
    });

    app.get("/my-request", verifyAuth, async (req, res) => {
      const user = req.user;

      // Step 1: get requests
      const requests = await adoptionCollection
        .find({
          userEmail: user.email,
        })
        .toArray();

      // Step 2: get all pet ids
      const petIds = requests.map((item) => new ObjectId(item.petId));

      // Step 3: get pets
      const pets = await petCollection
        .find({
          _id: { $in: petIds },
        })
        .toArray();

      // Step 4: merge pets into requests
      const finalData = requests.map((request) => {
        const pet = pets.find((p) => p._id.toString() === request.petId);

        return {
          ...request,
          pet,
        };
      });

      res.send(finalData);
    });

    app.delete("/cancel-request/:id", verifyAuth, async (req, res) => {
      const { id } = req.params;
      const result = await adoptionCollection.deleteOne({
        petId: id,
        userEmail: req.user.email,
      });
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// app.listen(port, () => {
//   console.log(`Example app listening on port ${port}`);
// });
module.exports = app
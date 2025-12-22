const { MongoClient, ServerApiVersion } = require("mongodb");

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");
const { log } = require("console");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorize access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded info", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorize access" });
  }
};

const uri =
  "mongodb+srv://missionscic11:I6r3E9StM4MVkJLw@cluster0.tzswtx3.mongodb.net/?appName=Cluster0";

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
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    const dataBase = client.db("missionscic11DB");
    const userCollections = dataBase.collection("user");
    const requestCollections = dataBase.collection("request");
    const paymentsCollections = dataBase.collection("payments");

    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.role = "donor";
      userInfo.status = "active";
      userInfo.createdAt = new Date();
      const result = await userCollections.insertOne(userInfo);
      res.send(result);
    });

    app.get("/users", verifyToken, async (req, res) => {
      const result = await userCollections.find().toArray();
      res.status(200).send(result);
    });

    //user search
    app.get("/users-search", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;

      console.log("Query params:", req.query);

      const query = {};

      if (bloodGroup) {
        query.BloodGroup = bloodGroup;
      }

      if (district) {
        query.district = district;
      }

      if (upazila) {
        query.upozila = upazila;
      }

      console.log("Mongo query:", query);

      const result = await userCollections.find(query).toArray();

      console.log("Matched users:", result.length);

      res.send(result);
    });

    app.get(`/users/role/:email`, async (req, res) => {
      const { email } = req.params;
      const query = { email: email };
      const result = await userCollections.findOne(query);
      console.log(result);
      res.send(result);
    });

    app.patch("/update/user/status", verifyToken, async (req, res) => {
      const { email, status } = req.query;
      const query = { email: email };
      const updateStatus = {
        $set: {
          status: status,
        },
      };
      const result = await userCollections.updateOne(query, updateStatus);
      res.send(result);
    });

    // update role

    app.patch("/update/user/role", verifyToken, async (req, res) => {
      const { email, role } = req.query;
      const query = { email: email };
      const updateRole = {
        $set: {
          role: role,
        },
      };
      try {
        const result = await userCollections.updateOne(query, updateRole);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to update role" });
      }
    });

    app.get("/admin-stats", verifyToken, async (req, res) => {
      const users = await userCollections.countDocuments({ role: "donor" });
      const requests = await requestCollections.countDocuments();

      //  (payments collection)
      const payments = await paymentsCollections
        .aggregate([
          {
            $group: {
              _id: null,
              totalFunding: { $sum: "$amount" },
            },
          },
        ])
        .toArray();

      const funding = payments.length > 0 ? payments[0].totalFunding : 0;

      res.send({
        totalDonors: users,
        totalRequests: requests,
        totalFunding: funding,
      });
    });

    // recent req

    app.get("/my-recent-requests", verifyToken, async (req, res) => {
      const email = req.decoded_email;
      const query = { requester_email: email };
      const result = await requestCollections.find(query).sort({ _id: -1 });
      res.send(result);
    });

    //  (Done/Canceled)
    app.patch("/requests/status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const status = req.query.status;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { status: status } };
      const result = await requestCollections.updateOne(filter, updateDoc);
      res.send(result);
    });

    // doner search
    app.get("/users-search", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      const query = {};

      if (bloodGroup) query.bloodGroup = bloodGroup;
      if (district) query.district = district;
      if (upazila) query.upazila = upazila;

      try {
        const result = await usersCollections.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching donors" });
      }
    });

    // request

    app.post("/requests", verifyToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollections.insertOne(data);
      res.send(result);
    });

    app.get("/requests", async (req, res) => {
      try {
        const result = await requestCollections.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Data fetch failed" });
      }
    });

    //single req api
    const { ObjectId } = require("mongodb");

    app.get("/requests/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await requestCollections.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Request not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch request" });
      }
    });

    app.get("/my-request", verifyToken, async (req, res) => {
      const email = req.decoded_email;
      const size = Number(req.query.size);
      const page = Number(req.query.page);
      const filter = req.query.filter;

      const query = { requester_email: email };
      if (filter) {
        query.status = filter;
      }

      const result = await requestCollections
        .find(query)
        .limit(size)
        .skip(size * page)
        .toArray();

      const totalRequest = await requestCollections.countDocuments(query);
      res.send({ request: result, totalRequest });
    });

    // app.get("/requests-search", async (req, res) => {
    //   const { bloodGroup, district, upazila } = req.query;
    //   const query = {};
    //   if (!query) {
    //     return;

    //     query.requester_district = district;
    //   }

    //   if (upazila) {
    //     query.requester_upazila = upazila;
    //   }
    //   const result = await requestCollections.find(query).toArray();
    //   res.send(result);
    // });

    app.get("/requests-search", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;
      const query = {};

      if (bloodGroup) {
        query.bloodGroup = bloodGroup;
      }
      if (district) {
        query.requester_district = district;
      }
      if (upazila) {
        query.requester_upazila = upazila;
      }

      try {
        const result = await requestCollections.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error searching data" });
      }
    });

    app.post("/create-payment-checkout", async (req, res) => {
      const information = req.body;
      const amount = parseInt(information.donateAmount) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: "please donate",
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          donorName: information?.donorName,
        },
        customer_email: information?.donorEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    //new
    app.post("/success-payment", async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      console.log(session);

      const transactionId = session.payment_intent;

      const isPaymentExist = await paymentsCollections.findOne({
        transactionId,
      });
      if (isPaymentExist) {
        return res.status(400).send("Already Exist");
      }

      if (session.payment_status == "paid") {
        const paymentInfo = {
          amount: session.amount_total / 100,
          currency: session.currency,
          donorEmail: session.customer_email,
          transactionId,
          donorName: session.metadata?.donorName || "unknown user",
          payment_status: session.payment_status,
          paidAt: new Date(),
        };
        const result = await paymentsCollections.insertOne(paymentInfo);
        return res.send(result);
      }
    });

    app.get("/all-payments", verifyToken, async (req, res) => {
      try {
        const size = parseInt(req.query.size) || 3;
        const page = parseInt(req.query.page) || 0;

        const query = {};
        const result = await paymentsCollections
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();

        const totalRequest = await paymentsCollections.countDocuments(query);

        res.send({
          request: result,
          totalRequest,
        });
      } catch (error) {
        res.status(500).send({ message: "Error fetching payments" });
      }
    });

    // Profile Update
    app.patch("/users-update/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const userInfo = req.body;
        const query = { email: email };

        const updatedDoc = {
          $set: {
            name: userInfo.name,
            mainUrl: userInfo.image,
            bloodGroup: userInfo.bloodGroup,
            district: userInfo.district,
            upozila: userInfo.upozila,
          },
        };

        console.log("Updating User:", email, userInfo);

        const result = await userCollections.updateOne(query, updatedDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Update Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello, Mission SCIC ");
});

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});

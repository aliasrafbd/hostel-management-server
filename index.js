const express = require('express');
const cors = require('cors');

require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sa1jr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");


        const mealsCollection = client.db('hostelDB').collection('meals');
        const requestedMealsCollection = client.db('hostelDB').collection('requestedmeals');
        const userCollection = client.db('hostelDB').collection('users');

        app.get('/meals', async (req, res) => {
            const result = await mealsCollection.find().toArray();
            res.send(result);
        })

        app.post('/meals', async (req, res) => {
            const meal = req.body;
            const result = await mealsCollection.insertOne(meal);
            res.send(result);
        })

        app.get('/requestedmeals', async (req, res) => {
            const result = await requestedMealsCollection.find().toArray();
            res.send(result);
        })

        app.post('/requestedmeals', async (req, res) => {
            const meal = req.body;
            const { userEmail, _id } = req.body;
            console.log(meal);

            console.log(userEmail, _id);

            const existingRequest = await requestedMealsCollection.findOne({ userEmail, _id });
            if (existingRequest) {
                return res.status(400).json({ message: 'You have already requested this meal.' });
            }

            const result = await requestedMealsCollection.insertOne(meal);
            res.send(result);
        })

        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.get('/meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealsCollection.findOne(query);
            res.send(result);
        })

        app.get('/user/admin/:email', async (req, res) => {
            const email = req.params.email;

            // if(email !== req.decoded.email) {
            //     return res.status(403).send({message: "unauthorized Access"})
            // }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        })

        app.get('/users/premium/:email', async (req, res) => {
            const email = req.params.email;

            // if(email !== req.decoded.email) {
            //     return res.status(403).send({message: "unauthorized Access"})
            // }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let premiumMember = false;
            if (user) {
                premiumMember = (user?.badge === 'Silver' ? true : false) || (user?.badge === 'Gold' ? true : false) || (user?.badge === 'Platinum' ? true : false);
            }
            res.send({ premiumMember });
        })

        app.put('/meals/:mealId/like', async (req, res) => {
            const { mealId } = req.params;
            const { userEmail } = req.body; // Get userEmail from request body

            try {
                const meal = await mealsCollection.findOne({ _id: new ObjectId(mealId) });

                if (!meal) {
                    return res.status(404).json({ message: 'Meal not found' });
                }

                // Check if the user has already liked the meal
                if (meal.reaction?.userEmails?.includes(userEmail)) {
                    return res.status(400).json({ message: 'User has already liked this meal' });
                }

                // Update the reaction count and add the user's email to the reaction list
                const updatedReaction = {
                    count: (meal.reaction?.count || 0) + 1,
                    userEmails: [...(meal.reaction?.userEmails || []), userEmail],
                };

                await mealsCollection.updateOne(
                    { _id: new ObjectId(mealId) },
                    { $set: { reaction: updatedReaction } }
                );

                res.status(200).json({ message: 'Meal liked successfully', reaction: updatedReaction });
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: 'Server error' });
            }
        });




        // for rating:

            // Route to update the rating
            app.put('/meal/:id/rate', async (req, res) => {
                const id = req.params.id;
                const { rating } = req.body; // Rating provided by the user

                try {
                    // Find the meal by its ID
                    const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

                    if (!meal) {
                        return res.status(404).send('Meal not found');
                    }

                    // Calculate the new average rating (this assumes the client is sending only a single rating for simplicity)
                    const totalRatings = [...meal.ratings, rating].reduce((sum, rate) => sum + rate, 0);
                    const averageRating = totalRatings / (meal.ratings.length + 1);

                    // Update the meal document with the new average rating
                    const updateResult = await mealsCollection.updateOne(
                        { _id: new ObjectId(id) },
                        {
                            $set: {
                                rating: averageRating, // Update the average rating field
                            },
                            $push: { ratings: rating }, // Add the new rating to the ratings array
                        }
                    );

                    if (updateResult.modifiedCount === 0) {
                        return res.status(500).send('Failed to update rating');
                    }

                    res.status(200).send('Rating updated successfully');
                } catch (error) {
                    console.error('Error updating rating:', error);
                    res.status(500).send('Error updating rating');
                }
            });




        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;

            // insert user if email doest not exist  
            // many ways: email unique? upset? simple checking 

            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already Exist", insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })



        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: "admin",
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })




    } finally {

    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send("Hostel Management System server is running");
})

app.listen(port, () => {
    console.log(`Hostel Management System server running on port:`, port);
})
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
        const upcomingMealsCollection = client.db('hostelDB').collection('upcomingmeals');
        const requestedMealsCollection = client.db('hostelDB').collection('requestedmeals');
        const userCollection = client.db('hostelDB').collection('users');

        app.get('/meals', async (req, res) => {
            const search = req.query.search || ""; // Search term
            const category = req.query.category || ""; // Category filter
            const minPrice = parseFloat(req.query.minPrice) || 0; // Minimum price filter
            const maxPrice = parseFloat(req.query.maxPrice) || Number.MAX_SAFE_INTEGER; // Maximum price filter

            const query = {
                $and: [
                    // Search across multiple fields
                    {
                        $or: [
                            { title: { $regex: search, $options: "i" } },
                            { category: { $regex: search, $options: "i" } },
                            { description: { $regex: search, $options: "i" } },
                            { ingredients: { $regex: search, $options: "i" } },
                            { postTime: { $regex: search, $options: "i" } },
                            { price: { $regex: search, $options: "i" } },
                        ],
                    },
                    // Filter by category if specified
                    ...(category ? [{ category: { $regex: category, $options: "i" } }] : []),
                    // Filter by price range
                    { price: { $gte: minPrice, $lte: maxPrice } },
                ],
            };

            const meals = await mealsCollection.find(query).toArray();
            res.send(meals);
        });


        // Temporary route for manual debugging
        app.get('/mealssorted', async (req, res) => {
            try {
                // Extract the sort parameter from the query string
                const { sort } = req.query;
                console.log(sort);

                // Define sorting options
                const sortOptions = {
                    reaction: { "reaction.count": -1 }, // Sort by reaction.count (descending)
                    rating: { rating: -1 }, // Sort by rating (descending)
                };

                // Determine the sort criteria based on the provided parameter
                const sortCriteria = sortOptions[sort] || {};

                // Query the meals collection with the sorting criteria
                const meals = await mealsCollection.find().sort(sortCriteria).toArray();

                // Send the sorted meals as the response
                res.status(200).json(meals);
            } catch (error) {
                console.error('Error while fetching meals:', error);
                res.status(500).json({ error: 'Failed to fetch meals' });
            }
        });


        app.get('/admin-data', async (req, res) => {
            try {
                // Extract adminEmail from the query parameters
                const adminEmail = req.query.adminEmail;

                if (!adminEmail) {
                    return res.status(400).json({ error: 'adminEmail is required' });
                }

                // Count the number of meals added by this admin
                const mealCount = await mealsCollection.countDocuments({ distributorEmail: adminEmail });

                // Respond with the meal count
                res.status(200).json({ mealCount });
            } catch (error) {
                console.error('Error fetching meal count:', error);
                res.status(500).json({ error: 'Failed to fetch meal count' });
            }
        });



        app.delete('/mealssorted/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const query = { _id: new ObjectId(id) }
                const result = await mealsCollection.deleteOne(query);
                res.send(result);
            } catch (error) {
                console.error("Error deleting the meal:", error);
                res.status(500).send({ message: "Failed to remove this meal" });
            }
        });



        app.post('/meals', async (req, res) => {
            const meal = req.body;
            const result = await mealsCollection.insertOne(meal);
            res.send(result);
        })

        app.post('/upcomingmeals', async (req, res) => {
            const meal = req.body;
            const result = await upcomingMealsCollection.insertOne(meal);
            res.send(result);
        })

        app.post('/publish-meal/:id', async (req, res) => {
            const id = req.params.id;
            console.log('Publish meal API hit, ID:', id); // Debug

            try {
                const mealToPublish = await upcomingMealsCollection.findOne({ _id: new ObjectId(id) });
                if (!mealToPublish) {
                    console.error('Meal not found'); // Debug
                    return res.status(404).send({ message: 'Meal not found' });
                }

                const result = await mealsCollection.insertOne(mealToPublish);
                if (result.insertedId) {
                    await upcomingMealsCollection.deleteOne({ _id: new ObjectId(id) });
                    console.log('Meal published successfully'); // Debug
                    res.send({ message: 'Meal published successfully' });
                } else {
                    console.error('Failed to publish meal'); // Debug
                    res.status(500).send({ message: 'Failed to publish the meal' });
                }
            } catch (error) {
                console.error('Error during publish meal:', error); // Debug
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });


        app.get('/upcomingmeals', async (req, res) => {
            const result = await upcomingMealsCollection.find().toArray();
            res.send(result);
        })


        app.get('/requestedmeals', async (req, res) => {
            try {
                const { name = "", userEmail = "" } = req.query;

                console.log(name, userEmail);
        
                // Build the query object
                const query = {};
                if (name) {
                    query.name = { $regex: name, $options: "i" }; // Case-insensitive partial match
                }
                if (userEmail) {
                    query.userEmail = userEmail;
                }
        
                // Fetch the requested meals based on the query
                const meals = await requestedMealsCollection.find(query).toArray();
        
                // Send the meals as the response
                res.status(200).json(meals);
            } catch (error) {
                console.error('Error fetching requested meals:', error);
                res.status(500).json({ error: 'Failed to fetch requested meals' });
            }
        });
        
        // app.get('/requestedmeals', async (req, res) => {
        //     const result = await requestedMealsCollection.find().toArray();
        //     res.send(result);
        // })

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
        // app.put('/meal/:id/rate', async (req, res) => {
        //     const id = req.params.id;
        //     const { rating } = req.body; // Rating provided by the user

        //     try {
        //         // Find the meal by its ID
        //         const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

        //         if (!meal) {
        //             return res.status(404).send('Meal not found');
        //         }

        //         // Calculate the new average rating (this assumes the client is sending only a single rating for simplicity)
        //         const totalRatings = [...meal.ratings, rating].reduce((sum, rate) => sum + rate, 0);
        //         const averageRating = totalRatings / (meal.ratings.length + 1);

        //         // Update the meal document with the new average rating
        //         const updateResult = await mealsCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             {
        //                 $set: {
        //                     rating: averageRating, // Update the average rating field
        //                 },
        //                 $push: { ratings: rating }, // Add the new rating to the ratings array
        //             }
        //         );

        //         if (updateResult.modifiedCount === 0) {
        //             return res.status(500).send('Failed to update rating');
        //         }

        //         res.status(200).send('Rating updated successfully');
        //     } catch (error) {
        //         console.error('Error updating rating:', error);
        //         res.status(500).send('Error updating rating');
        //     }
        // });


        app.patch('/meals/:id/rating', async (req, res) => {
            const { id } = req.params;
            console.log(req.body);
            const { newRating } = req.body; // Expecting newRating in the request body
            console.log(newRating);

            try {
                const updatedMeal = await mealsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { rating: newRating } }
                );
                res.status(200).json(updatedMeal);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // app.patch('/meals/:id/rating', async (req, res) => {
        //     const { id } = req.params; // Get meal ID from URL
        //     const { newRating, userEmail } = req.body; // Get newRating and userEmail from request body

        //     // Validate input
        //     if (!newRating || !userEmail) {
        //         return res.status(400).json({ message: 'newRating and userEmail are required.' });
        //     }

        //     try {
        //         const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });

        //         // Check if meal exists
        //         if (!meal) {
        //             return res.status(404).json({ message: 'Meal not found' });
        //         }

        //         // Initialize `rating` object if it doesn't exist
        //         if (!meal.rating || typeof meal.rating !== 'object') {
        //             meal.rating = { rating: newRating, userEmails: [] };
        //         }

        //         // Check if the user has already rated
        //         if (meal.rating.userEmails.includes(userEmail)) {
        //             return res.status(400).json({ message: 'User has already rated this meal' });
        //         }

        //         // Update the rating object
        //         const updatedRating = {
        //             rating: newRating, // Use the frontend-calculated rating
        //             userEmails: [...meal.rating.userEmails, userEmail], // Add the user email to the list
        //         };

        //         // Update the document in the database
        //         await mealsCollection.updateOne(
        //             { _id: new ObjectId(id) },
        //             { $set: { rating: updatedRating } }
        //         );

        //         res.status(200).json({ message: 'Rating updated successfully', updatedRating });
        //     } catch (error) {
        //         res.status(500).json({ error: error.message });
        //     }
        // });



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


        // Route to fetch meals with search functionality
        // app.get('/api/meals', async (req, res) => {
        //     const search = req.query.search || ""; // Get the search term from query params
        //         // Search meals across multiple fields
        //         const meals = await mealsCollection
        //             .find({
        //                 $or: [
        //                     { title: { $regex: search, $options: "i" } },
        //                     { category: { $regex: search, $options: "i" } },
        //                     { description: { $regex: search, $options: "i" } },
        //                     { ingredients: { $regex: search, $options: "i" } },
        //                     { postTime: { $regex: search, $options: "i" } },
        //                     { price: { $regex: search, $options: "i" } },
        //                 ],
        //             })
        //             .toArray();
        //     });


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
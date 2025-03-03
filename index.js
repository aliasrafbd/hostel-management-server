const express = require('express');

const cookieParser = require('cookie-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_PAYMENT_SECRET_KEY);

const app = express();

app.use(cookieParser());

const port = process.env.PORT || 5000;

app.use(cors({
    origin: ['https://hostel-management-28-01-24.netlify.app', 'http://localhost:5173'],
    credentials: true
}));

app.use(express.json());


const verifyToken = (req, res, next) => {
    const token = req?.cookies?.token; 

    if (!token) {
        return res.status(401).json({ message: "Unauthorized Access: No Token" });
    }

    jwt.verify(token, process.env.JWT_TOKEN_SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Unauthorized Access: Invalid Token" });
        }

        req.tokenOwnerEmail = decoded.email; // Extract email from token payload
        next();
    });
};

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sa1jr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: false, // Disable strict API mode
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const mealsCollection = client.db('hostelDB').collection('meals');
        const upcomingMealsCollection = client.db('hostelDB').collection('upcomingmeals');
        const requestedMealsCollection = client.db('hostelDB').collection('requestedmeals');
        const servedMealsCollection = client.db('hostelDB').collection('servedmeals');
        const userCollection = client.db('hostelDB').collection('users');
        const paymentCollection = client.db('hostelDB').collection('packagepaymentdata');


        // use verify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.tokenOwnerEmail;
            let query = {};
            if (email) {
                query = { email: email };
            }
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access: You are not admin' });
            }
            next();
        }


        // Create a text index on the upcomingMealsCollection
        await upcomingMealsCollection.createIndex({
            title: "text",
            category: "text",
            ingredients: "text",
            description: "text",
            distributorName: "text",
            distributorEmail: "text",
        });


        await mealsCollection.createIndex({
            title: "text",
            category: "text",
            ingredients: "text",
            description: "text",
            distributorName: "text",
            distributorEmail: "text"
        });


        app.get('/reviews', verifyToken, verifyAdmin, async (req, res) => {

            const page = parseInt(req.query.page);
            const size = parseInt(req.query.size);
            const result = await mealsCollection.find()
                .skip((page - 1) * size)
                .limit(size)
                .toArray();
            res.send(result);
        })

        app.get("/requestedmeals/:email", async (req, res) => {
            const { email } = req.params;
            try {
                const meals = await requestedMealsCollection.find({ userEmail: email }).toArray();
                res.json(meals);
            } catch (error) {
                res.status(500).json({ error: "Failed to fetch requested meals" });
            }
        });
    

        app.get("/overview-stats", async (req, res) => {
            try {
                const totalMeals = await mealsCollection.countDocuments();
                const totalUsers = await userCollection.countDocuments();
                const totalReviews = await mealsCollection.aggregate([{ $group: { _id: null, total: { $sum: "$reviews.review_count" } } }]).toArray();
        
                const categoryStats = await mealsCollection.aggregate([
                    { $group: { _id: "$category", count: { $sum: 1 } } },
                    { $project: { _id: 0, category: "$_id", count: 1 } }
                ]).toArray();
        
                const reactionStats = await mealsCollection.aggregate([
                    { $group: { _id: "$reaction.count", count: { $sum: 1 } } },
                    { $project: { _id: 0, count: 1, label: { $concat: ["Reactions: ", { $toString: "$_id" }] } } }
                ]).toArray();
        
                res.json({
                    totalMeals,
                    totalUsers,
                    totalReviews: totalReviews[0]?.total || 0,
                    categoryStats,
                    reactionStats
                });
            } catch (error) {
                res.status(500).json({ error: "Failed to fetch overview stats" });
            }
        });
        


        app.get('/allreviews', verifyToken, async (req, res) => {
            const result = await mealsCollection.find().limit(10).toArray();
            res.send(result);
        })



        app.patch("/servedmeals/:id", verifyToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;

            try {
                const result = await requestedMealsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status } }
                );

                if (result.modifiedCount > 0) {
                    res.status(200).send({ message: "Meal status updated successfully." });
                } else {
                    res.status(404).send({ message: "Meal not found or already updated." });
                }
            } catch (error) {
                res.status(500).send({ message: "Error updating meal status.", error });
            }
        });


        app.get('/upcomingmealsall', verifyToken, async (req, res) => {
            const result = await upcomingMealsCollection.find().toArray();
            res.send(result);
        })

        app.put('/meals/:id', verifyToken, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: false };
            const updatedMealData = req.body;
            const newMealData = {
                $set: {
                    title: updatedMealData.title,
                    category: updatedMealData.category,
                    ingredients: updatedMealData.ingredients,
                    description: updatedMealData.description,
                    price: updatedMealData.price,
                    image: updatedMealData.image,
                    postTime: updatedMealData.postTime,
                    distributorEmail: updatedMealData.distributorEmail,
                    distributorName: updatedMealData.distributorName,
                }
            }
            const result = await mealsCollection.updateOne(filter, newMealData, options)
            res.send(result);
        })

        app.get('/meals/hostel', async (req, res) => {
            const { search } = req.query; 
            try {
                let query = {};

                if (search) {
                    const searchTerm = search.toLowerCase(); 
                    query = {
                        $or: [
                            { title: { $regex: searchTerm, $options: 'i' } }, 
                            { category: { $regex: searchTerm, $options: 'i' } }, 
                            { description: { $regex: searchTerm, $options: 'i' } }, 
                            { ingredients: { $regex: searchTerm, $options: 'i' } }, 
                            { price: { $regex: searchTerm, $options: 'i' } }, 
                            { postTime: { $regex: searchTerm, $options: 'i' } }, 
                        ],
                    };
                }

                const result = await mealsCollection.find(query).toArray(); 
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });

        app.put('/update-requested-meals', async (req, res) => {
            try {
                const updatedMeals = req.body; 
                const result = await mealsCollection.updateMany(
                    { userEmail: updatedMeals[0].userEmail }, 
                    { $set: { meals: updatedMeals } } 
                );
                res.status(200).send({ success: true, message: 'Meals updated successfully', result });
            } catch (error) {
                res.status(500).send({ success: false, message: error.message });
            }
        });




        app.get('/meals/search', async (req, res) => {
            try {
                const searchQuery = req.query.q; 
                const results = await mealsCollection
                    .find({
                        $text: { $search: searchQuery } 
                    })
                    .toArray();

                res.json(results); 
            } catch (error) {
                res.status(500).json({ message: "Internal server error" });
            }
        });



        // JWT Related API 
        app.post('/jwt', (req, res) => {
            const user = req.body;

            const token = jwt.sign(user, process.env.JWT_TOKEN_SECRET_KEY, { expiresIn: '5h' });

            res
                .cookie('token', token, {
                    httpOnly: true, 
                    maxAge: 3600 * 1000, 
                    secure: process.env.NODE_ENV === 'production', 
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict', 
                })
                .send({
                    status: true,
                })
        })

        app.post('/logout', (req, res) => {

            res
                .clearCookie('token', {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === 'production' ? true : false,
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                })
                .send({ status: true })


        })


        // Stripe Payment Related API 
        // Create Payment Intent
        // Route to create payment intent
        // Endpoint to create a PaymentIntent

        app.post('/create-payment-intent', async (req, res) => {
            const { amount } = req.body;
            if (!amount) {
                return res.status(400).json({
                    success: false,
                    error: 'Amount is required in the request body.',
                });
            }

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    automatic_payment_methods: { enabled: true },
                });

                const clientSecret = paymentIntent.client_secret;

                res.json({
                    success: true,
                    amount: amount,
                    clientSecret: clientSecret,
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            }
        });


        app.get('/payments/:email', verifyToken, async (req, res) => {
            const userEmail = req.params.email;

            if (req?.tokenOwnerEmail !== userEmail) {
                return res.status(403).json({ message: "Forbidden Access: Email not matched" });
            }

            try {
                const payments = await paymentCollection.find({ userEmail }).toArray();

                if (payments.length > 0) {
                    res.send({ data: payments }); 
                } else {
                    res.send({
                        message: 'No payments found for the specified email.',
                        data: []
                    });
                }
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch payments', error: error.message });
            }
        });


        app.get('/meals', async (req, res) => {
            try {
                const search = req.query.search || ""; 
                const category = req.query.category || ""; 
                const minPrice = parseFloat(req.query.minPrice) || 0; 
                const maxPrice = parseFloat(req.query.maxPrice) || Number.MAX_SAFE_INTEGER; 
                const page = parseInt(req.query.page) || 1; 
                const limit = 2; 

                const query = {
                    $and: [
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
                        ...(category ? [{ category: { $regex: category, $options: "i" } }] : []),
                        { price: { $gte: minPrice, $lte: maxPrice } },
                    ],
                };

                const totalCount = await mealsCollection.countDocuments(query);

                const meals = await mealsCollection
                    .find(query)
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray(); 

                res.status(200).json({
                    success: true,
                    data: meals,
                    pagination: {
                        total: totalCount,
                        page,
                        limit,
                        totalPages: Math.ceil(totalCount / limit),
                    },
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "An error occurred while fetching meals.",
                    error: error.message,
                });
            }
        });

        app.get('/mealssorted', async (req, res) => {
            try {
                const { sort } = req.query;
                const page = parseInt(req.query.page);
                const size = parseInt(req.query.size);

                const sortOptions = {
                    reaction: { "reaction.count": -1 }, 
                    reviews: { "reviews.review_count": -1 }, 
                };

                const sortCriteria = sortOptions[sort] || {}; 

                const meals = await mealsCollection.find()
                    .sort(sortCriteria)
                    .skip(page * size)
                    .limit(size)
                    .toArray();

                res.status(200).json(meals);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch sorted meals' });
            }
        });


        app.get('/servedmeals', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1; 
                const size = parseInt(req.query.size) || 10; 
                const name = req.query.name || ""; 
                const userEmail = req.query.userEmail || ""; 

                const searchQuery = {};

                if (name) {
                    searchQuery.name = { $regex: name, $options: "i" }; 
                }

                if (userEmail) {
                    searchQuery.userEmail = { $regex: userEmail, $options: "i" }; 
                }

                const meals = await requestedMealsCollection
                    .find(searchQuery)
                    .skip((page - 1) * size)
                    .limit(size)
                    .toArray();

                const totalCount = await requestedMealsCollection.countDocuments(searchQuery); 

                res.send({
                    meals,
                    totalCount,
                });
            } catch (error) {
                res.status(500).send({ error: "Failed to fetch meals." });
            }
        });


        app.delete('/meals/:mealId/reviews', async (req, res) => {
            const { mealId } = req.params;
            const { userEmail } = req.body;  

            try {
                const mealObjectId = new ObjectId(mealId);

                const meal = await mealsCollection.findOne({ _id: mealObjectId });

                if (!meal) {
                    return res.status(404).json({ message: 'Meal not found' });
                }

                const reviewIndex = meal.reviews.reviews.findIndex(
                    review => review.userEmail === userEmail
                );

                if (reviewIndex === -1) {
                    return res.status(404).json({ message: 'Review not found for the given user' });
                }

                meal.reviews.reviews.splice(reviewIndex, 1);

                meal.reviews.review_count -= 1;

                const updateResult = await mealsCollection.updateOne(
                    { _id: mealObjectId },  
                    {
                        $set: {
                            "reviews.reviews": meal.reviews.reviews, 
                            "reviews.review_count": meal.reviews.review_count  
                        }
                    }
                );

                if (updateResult.modifiedCount === 1) {
                    return res.status(200).json({ message: 'Review deleted successfully' });
                } else {
                    return res.status(500).json({ message: 'Failed to update meal after deleting review' });
                }

            } catch (error) {
                return res.status(500).json({ message: 'Server error' });
            }
        });



        app.get('/servemealscount', async (req, res) => {
            const count = await requestedMealsCollection.estimatedDocumentCount();
            res.send({ count })
        })

        // pagination related api in all meals 
        app.get('/mealscount', async (req, res) => {
            const count = await mealsCollection.estimatedDocumentCount();
            res.send({ count })
        })

        // pagination related api in all meals 
        app.get('/upcomingmealscount', verifyToken, async (req, res) => {
            const count = await upcomingMealsCollection.estimatedDocumentCount();
            res.send({ count })
        })

        // Endpoint to update likes of upcoming meals
        app.put('/upcomingmeals/:mealId/like', verifyToken, async (req, res) => {
            const { mealId } = req.params;
            const { userEmail } = req.body; 

            try {
                const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

                if (!meal) {
                    return res.status(404).json({ message: 'Meal not found' });
                }

                if (meal.reaction?.userEmails?.includes(userEmail)) {
                    return res.status(400).json({ message: 'User has already liked this meal' });
                }

                const updatedReaction = {
                    count: (meal.reaction?.count || 0) + 1,
                    userEmails: [...(meal.reaction?.userEmails || []), userEmail],
                };

                await upcomingMealsCollection.updateOne(
                    { _id: new ObjectId(mealId) },
                    { $set: { reaction: updatedReaction } }
                );

                res.status(200).json({ message: 'Meal liked successfully', reaction: updatedReaction });

            } catch (error) {
                res.status(500).json({ message: 'Server error' });
            }
        });


        app.get('/admin-data', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const adminEmail = req.query.adminEmail;

                if (req?.tokenOwnerEmail !== adminEmail) {
                    return res.status(403).json({ message: "Forbidden Access: Email not matched" });
                }

                if (!adminEmail) {
                    return res.status(400).json({ error: 'adminEmail is required' });
                }

                const mealCount = await mealsCollection.countDocuments({ distributorEmail: adminEmail });

                res.status(200).json({ mealCount });
            } catch (error) {
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
                res.status(500).send({ message: "Failed to remove this meal" });
            }
        });


        app.delete('/requestedmeals/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            try {
                const query = { _id: new ObjectId(id) }
                const result = await requestedMealsCollection.deleteOne(query);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to remove this meal" });
            }
        });

        app.put('/mealssorted/:id/reviews', async (req, res) => {
            const { id } = req.params; // Meal ID
            const { review_count, reviews } = req.body;
            try {
                const result = await mealsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            "reviews.review_count": review_count,
                            "reviews.reviews": reviews,
                        },
                    }
                );
                if (result.modifiedCount > 0) {
                    res.status(200).send({ success: true, message: 'Reviews reset successfully' });
                } else {
                    res.status(404).send({ success: false, message: 'Meal not found' });
                }
            } catch (err) {
                res.status(500).send({ success: false, message: 'Failed to reset reviews' });
            }
        });

        app.post('/meals', verifyToken, verifyAdmin, async (req, res) => {
            const meal = req.body;
            const result = await mealsCollection.insertOne(meal);
            res.send(result);
        })

        app.post('/package-payment-data', async (req, res) => {
            const paymentData = req.body;
            const result = await paymentCollection.insertOne(paymentData);
            res.send(result);
        })


        app.patch('/update-badge', async (req, res) => {
            const paymentData = req.body;

            const { userEmail, packageName } = paymentData;

            if (!userEmail || !packageName) {
                return res.status(400).json({ error: 'userEmail and packageName are required.' });
            }

            let badge = "";
            if (packageName === "silver") {
                badge = "Silver";
            } else if (packageName === "gold") {
                badge = "Gold";
            } else if (packageName === "platinum") {
                badge = "Platinum";
            }

            const result = await userCollection.updateOne(
                { email: userEmail },
                { $set: { badge } }
            );

            if (result.modifiedCount > 0) {
                res.status(200).json({ success: true, message: 'Badge updated successfully.' });
            } else {
                res.status(404).json({ success: false, message: 'User not found.' });
            }
        });



        app.post('/upcomingmeals', async (req, res) => {
            const meal = req.body;
            const result = await upcomingMealsCollection.insertOne(meal);
            res.send(result);
        })

        app.post('/publish-meal/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            try {
                const mealToPublish = await upcomingMealsCollection.findOne({ _id: new ObjectId(id) });
                if (!mealToPublish) {
                    return res.status(404).send({ message: 'Meal not found' });
                }

                const result = await mealsCollection.insertOne(mealToPublish);
                if (result.insertedId) {
                    await upcomingMealsCollection.deleteOne({ _id: new ObjectId(id) });
                    res.send({ message: 'Meal published successfully' });
                } else {
                    res.status(500).send({ message: 'Failed to publish the meal' });
                }
            } catch (error) {
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });


        app.get('/upcomingmeals', verifyToken, async (req, res) => {
            const page = parseInt(req.query.page) || 0; 
            const size = parseInt(req.query.size) || 10; 

            try {
                const result = await upcomingMealsCollection
                    .find()
                    .skip(page * size)
                    .limit(size)
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Failed to fetch meals" });
            }
        });



        app.post('/insert-served-meals', async (req, res) => {
            const meals = req.body.meals; 

            try {
                const result = await servedMealsCollection.insertMany(meals);
                res.status(201).json({
                    message: 'Meals inserted successfully',
                    insertedCount: result.insertedCount,
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to insert meals' });
            }
        });

        app.get('/requestedmeals', async (req, res) => {
            try {
                const { name = "", userEmail = "" } = req.query;

                const query = {};
                if (name) {
                    query.name = { $regex: name, $options: "i" }; 
                }
                if (userEmail) {
                    query.userEmail = userEmail;
                }

                const meals = await requestedMealsCollection.find(query).toArray();

                if (meals.length === 0) {
                    let message = "No meals found";
                    if (name && !userEmail) {
                        message = `No meals found for name: ${name}`;
                    } else if (!name && userEmail) {
                        message = `No meals found for userEmail: ${userEmail}`;
                    } else if (name && userEmail) {
                        message = `No meals found for name: ${name} and userEmail: ${userEmail}`;
                    }
                    return res.status(404).json({ message });
                }

                res.status(200).json(meals);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch requested meals' });
            }
        });

        app.get('/requestedmeals/:email', async (req, res) => {
            const userEmail = req.params.email;

            // if (req?.tokenOwnerEmail !== userEmail) {
            //     return res.status(403).json({ message: "Forbidden Access: Email not matched" });
            // }

            try {
                const requestedMeals = await requestedMealsCollection.find({ userEmail }).toArray();

                if (requestedMeals.length > 0) {
                    res.send({ requestedMeals }); 
                } else {
                    res.send({
                        message: 'No requested meals found for the specified email.',
                        data: []
                    });
                }
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch requested meals', error: error.message });
            }
        });


        app.post('/requestedmeals', async (req, res) => {
            const meal = req.body;
            const { userEmail, _id } = req.body;

            const existingRequest = await requestedMealsCollection.findOne({ userEmail, _id });
            if (existingRequest) {
                return res.status(400).json({ message: 'You have already requested this meal.' });
            }

            const result = await requestedMealsCollection.insertOne(meal);
            res.send(result);
        })


        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const { name, email } = req.query;

            try {
                const query = {};
                if (name) {
                    query.name = { $regex: name, $options: 'i' }; 
                }
                if (email) {
                    query.email = { $regex: email, $options: 'i' }; 
                }

                const result = await userCollection.find(query).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch users', error: error.message });
            }
        });



        app.get('/users/email/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (req?.tokenOwnerEmail !== email) {
                return res.status(403).json({ message: "Forbidden Access: Email not matched" });
            }

            try {
                const result = await userCollection.findOne({ email: email });
                if (!result) {
                    return res.status(404).send({ message: 'User not found' });
                }
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch user' });
            }
        });


        app.get('/meal/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const query = { _id: new ObjectId(id) };
                const result = await mealsCollection.findOne(query);
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Error fetching meal' });
            }
        });

        app.get('/user/admin/:email', async (req, res) => {
            const email = req.params.email;

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

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let premiumMember = false;
            if (user?.badge === "Gold" || user?.badge === "Silver" || user?.badge === "Platinum") {
                premiumMember = true;
            }
            res.send(premiumMember);
        })

        app.put('/meals/:mealId/like', async (req, res) => {
            const { mealId } = req.params;
            const { userEmail } = req.body; 

            try {
                const meal = await mealsCollection.findOne({ _id: new ObjectId(mealId) });

                if (!meal) {
                    return res.status(404).json({ message: 'Meal not found' });
                }

                if (meal.reaction?.userEmails?.includes(userEmail)) {
                    return res.status(400).json({ message: 'User has already liked this meal' });
                }

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
                res.status(500).json({ message: 'Server error' });
            }
        });



        app.put('/api/update-review/:mealId', async (req, res) => {
            const mealId = req.params.mealId;  
            const { review, userEmail, name } = req.body; 

            if (!review) {
                return res.status(400).json({ error: 'Review text is required' });
            }

            const newReview = {
                review: review,
                userEmail: userEmail,
                name: name,
                createdAt: new Date(),  
            };

            const result = await mealsCollection.updateOne(
                { _id: new ObjectId(mealId) }, 
                {
                    $push: { "reviews.reviews": newReview },  
                    $inc: { "reviews.review_count": 1 },      
                }
            );

            res.send(result);

        });

        app.get('/reviews/:email', async (req, res) => {
            const userEmail = req.params.email;

            // if (req?.tokenOwnerEmail !== userEmail) {
            //     return res.status(403).json({ message: "Forbidden Access: Email not matched" });
            // }

            try {
                const meals = await mealsCollection.find({}).toArray();

                const filteredReviews = [];
                meals.forEach(meal => {
                    if (meal.reviews && Array.isArray(meal.reviews.reviews)) {
                        const userReviews = meal.reviews.reviews
                            .filter(review => review.userEmail === userEmail)
                            .map(review => ({
                                ...review,
                                _id: meal._id, 
                                mealTitle: meal.title 
                            }));
                        filteredReviews.push(...userReviews);
                    }
                });

                if (filteredReviews.length > 0) {
                    res.send(filteredReviews);
                } else {
                    res.send([]);
                }
            } catch (error) {
                res.status(500).json({ message: 'Failed to fetch reviews', error: error.message });
            }
        });


        app.patch('/meals/:id/rating', async (req, res) => {
            const { id } = req.params;
            let newRating = req.body.newUserRating;  

            newRating = parseFloat(newRating);

            if (isNaN(newRating)) {
                return res.status(400).json({ message: 'Invalid rating value' });
            }

            const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });
            if (!meal) {
                return res.status(404).json({ message: 'Meal not found' });
            }

            if (isNaN(meal.rating)) {
                return res.status(400).json({ message: 'Meal rating is invalid' });
            }

            const oldAverage = meal.rating;

            const newAverage = (oldAverage + newRating) / 2;

            const updateResult = await mealsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        rating: newAverage,  
                    }
                }
            );

            if (updateResult.modifiedCount === 0) {
                return res.status(400).json({ message: 'Failed to update the meal rating' });
            }

            const updatedMeal = await mealsCollection.findOne({ _id: new ObjectId(id) });
            res.status(200).json(updatedMeal);
        });


        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;


            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already Exist", insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })


        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
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
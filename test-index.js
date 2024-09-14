require("dotenv").config();
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static("public"));

app.set(`view engine`, `ejs`);

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Middleware for serving static files
app.use(express.static("public"));

// Set EJS as the templating engine
app.set("view engine", "ejs");

// Route to render the index page with products
app.get("/", async (req, res) => {
  try {
    // Fetch products from Stripe
    const products = await stripe.products.list();
    // Fetch prices from Stripe
    const prices = await stripe.prices.list();

    // Combine products with their prices
    const productsWithPrices = products.data.map((product) => {
      return {
        ...product,
        price: prices.data.find((price) => price.product === product.id),
      };
    });

    // Render the index page with products and prices
    res.render("index", { products: productsWithPrices });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route to handle checkout
app.get("/checkout/:priceId", async (req, res) => {
  try {
    const { priceId } = req.params;

    // Create a Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.BASE_URL}/success`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    // Redirect to the Stripe Checkout page
    res.redirect(session.url);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Route for successful payment
app.get("/success", (req, res) => {
  //res.send("Payment successful!");
  res.redirect("/");
});

// Route for cancelled payment
app.get("/cancel", (req, res) => {
  //res.send("Payment cancelled.");
  res.redirect("/");
});

/*************************************************************************************************/
/*
// Basic route
app.get("/", async (req, res) => {
  res.render("index.ejs",{ products }); // Render 'index.ejs' and pass product data to it
});
*/
/*************************************************************************************************/
// Route to create a subscription
app.post("/create-subscription", async (req, res) => {
  const { customerId, priceId } = req.body;

  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ["latest_invoice.payment_intent"],
    });

    res.redirect(`/subscription-success/${subscription.id}`);
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Route to handle successful subscription
app.get("/subscription-success/:subscriptionId", async (req, res) => {
  const { subscriptionId } = req.params;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const invoice = await stripe.invoices.retrieve(
      subscription.latest_invoice.id
    );

    res.render("subscription-success", { invoiceUrl: invoice.invoice_pdf });
  } catch (error) {
    console.error("Error retrieving subscription or invoice:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Webhook endpoint to handle invoice finalization
app.post("/webhook", async (req, res) => {
  const event = req.body;

  switch (event.type) {
    case "invoice.finalized":
      const invoice = event.data.object;
      // Handle the finalized invoice (e.g., update your database or notify user)
      console.log("Invoice finalized:", invoice.id);
      break;
    // Handle other events as needed
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});


/********************************************************************************************** */

app.get("/subscribe", async (req, res) => {
  const plan = req.query.plan;

  if (!plan) {
    //return res.status(400).send({message: 'Please provide a plan'})
    return res.send("Subscription plan not found");
  }

  let priceId;

  switch (plan.toLowerCase()) {
    case "starter":
      priceId = "price_1PyCLOB6iZbG8gNoumNCWI12";
      break;

    case "pro":
      priceId = "price_1PyCMTB6iZbG8gNodjNymAHW";
      break;
    default:
      return res.send("Subscription plan not found");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.BASE_URL}/cancel`,
  });

  //console.log(session);
  res.redirect(session.url);
});

app.get("/success", async (req, res) => {
  const session = await stripe.checkout.sessions.retrieve(
    req.query.session_id,
    { expand: ["subscription", "subscription.plan.product"] }
  );
  console.log(JSON.stringify(session));
  res.send("Subscribed successfully");
});

app.get("/cancel", (req, res) => {
  res.redirect("/");
});


app.get("/customers/:customerId", async (req, res) => {
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: req.params.customerId,
    return_url: `${process.env.BASE_URL}/`,
  });

  //console.log(portalSession);
  res.redirect(portalSession.url);
});


/******************************************************************************************///
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_KEY
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    //Event when the subscription started
    case "checkout.session.completed":
      console.log("New Subscription started!");
      console.log(event.data);
      break;

    // Event when the payment is successfull (every subscription interval)
    case "invoice.paid":
      console.log("Invoice paid");
      console.log(event.data);
      break;

    // Event when the payment failed due to card problems or insufficient funds (every subscription interval)
    case "invoice.payment_failed":
      console.log("Invoice payment failed!");
      console.log(event.data);
      break;

    // Event when subscription is updated
    case "customer.subscription.updated":
      console.log("Subscription updated!");
      console.log(event.data);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.send();
});
/*************************************************************************************************/

/*************************************************************************************************/
// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
/*************************************************************************************************/

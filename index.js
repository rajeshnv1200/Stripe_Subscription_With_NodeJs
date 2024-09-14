require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to serve static files
app.use(express.static("public"));

// Middleware to parse JSON bodies
app.use(bodyParser.json());

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
    console.error("Error fetching products:", error);
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
      mode: "subscription", // For subscription payments
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    // Redirect to the Stripe Checkout page
    res.redirect(session.url);
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Route for successful payment
app.get("/success", async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).send("Missing session_id in query parameters");
  }

  try {
    // Retrieve the Checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.render("success", { session });
  } catch (error) {
    console.error("Error retrieving checkout session:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Route for cancelled payment
app.get("/cancel", (req, res) => {
  res.redirect("/");
});

// Route for creating a subscription
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
app.get("/subscription-success", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      return res.status(400).send("Missing session_id in query parameters");
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = session.customer;

    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 1,
    });

    const invoice = invoices.data.length > 0 ? invoices.data[0] : null;
    const invoiceUrl = invoice ? invoice.invoice_pdf : null;

    res.render("success", { invoiceUrl });
  } catch (error) {
    console.error("Error handling subscription success:", error);
    res.status(500).send("An error occurred while processing your request.");
  }
});


// Webhook endpoint to handle events from Stripe
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET_KEY;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      console.log("Checkout session completed:", event.data.object);
      break;
    case "invoice.paid":
      console.log("Invoice paid:", event.data.object);
      break;
    case "invoice.payment_failed":
      console.log("Invoice payment failed:", event.data.object);
      break;
    case "customer.subscription.updated":
      console.log("Subscription updated:", event.data.object);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

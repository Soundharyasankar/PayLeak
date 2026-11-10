import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb://127.0.0.1:27017/payleak';

await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

// Find our demo user
const user = await db.collection('users').findOne({ email: 'demo@payleak.dev' });
if (!user) {
  console.error('Demo user not found!');
  process.exit(1);
}

const userId = user._id;

// 1. Seed Clients
const clients = [
  { userId, name: 'StrackPac AI Agent', email: 'agent@strackpac.dev', company: 'StrackPac Robotics', currency: 'USD', createdAt: new Date(), updatedAt: new Date() },
  { userId, name: 'CrawlerPal AI Agent', email: 'bot@crawlerpal.dev', company: 'CrawlerPal Networks', currency: 'USD', createdAt: new Date(), updatedAt: new Date() },
  { userId, name: 'Acme Research Labs', email: 'finance@acme.com', company: 'Acme Corp', currency: 'USD', createdAt: new Date(), updatedAt: new Date() },
];

await db.collection('clients').deleteMany({ userId });
const insertedClients = await db.collection('clients').insertMany(clients);
const client1Id = insertedClients.insertedIds[0];
const client2Id = insertedClients.insertedIds[1];
const client3Id = insertedClients.insertedIds[2];

// 2. Seed Real PayPal Sandbox Transactions
const txList = [
  {
    userId,
    clientId: client1Id,
    paypalTransactionId: '85Y91157RM5838030',
    transactionType: 'PAYMENT',
    status: 'COMPLETED',
    grossAmount: '1.00',
    grossCurrency: 'USD',
    feeAmount: '-0.52',
    feeCurrency: 'USD',
    feeSource: 'actual_paypal',
    paypalReportedNetAmount: '0.48',
    paypalReportedNetCurrency: 'USD',
    payleakCalculatedNetAmount: '0.48',
    payleakCalculatedNetCurrency: 'USD',
    netVerificationStatus: 'MATCH',
    netVerificationDifference: '0.00',
    netVerificationExplanation: 'PayPal-reported and PayLeak-calculated amounts match at the supported precision.',
    netVerificationReasons: [],
    transactionDate: new Date('2026-11-07T03:45:00Z'),
    financialDataStatus: 'complete',
    rawPaypal: {
      transaction_info: {
        transaction_id: '85Y91157RM5838030',
        paypal_order_id: '3WT58930C5815840M',
        transaction_amount: { value: '1.00', currency_code: 'USD' },
        fee_amount: { value: '-0.52', currency_code: 'USD' },
        net_amount: { value: '0.48', currency_code: 'USD' },
      },
      payer_info: {
        payer_name: { alternate_full_name: 'StrackPac AI Agent' },
        email_address: 'sb-kcumg53769517@personal.example.com',
      },
    },
    retrievedAt: new Date(),
    createdAt: new Date('2026-11-07T03:45:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client1Id,
    paypalTransactionId: '6PK69679MV007364R',
    transactionType: 'PAYMENT',
    status: 'COMPLETED',
    grossAmount: '1.00',
    grossCurrency: 'USD',
    feeAmount: '-0.52',
    feeCurrency: 'USD',
    feeSource: 'actual_paypal',
    paypalReportedNetAmount: '0.48',
    paypalReportedNetCurrency: 'USD',
    payleakCalculatedNetAmount: '0.48',
    payleakCalculatedNetCurrency: 'USD',
    netVerificationStatus: 'MATCH',
    netVerificationDifference: '0.00',
    netVerificationExplanation: 'PayPal-reported and PayLeak-calculated amounts match at the supported precision.',
    netVerificationReasons: [],
    transactionDate: new Date('2026-11-07T03:19:00Z'),
    financialDataStatus: 'complete',
    rawPaypal: {
      transaction_info: {
        transaction_id: '6PK69679MV007364R',
        paypal_order_id: '65N65520PW807883C',
        transaction_amount: { value: '1.00', currency_code: 'USD' },
        fee_amount: { value: '-0.52', currency_code: 'USD' },
        net_amount: { value: '0.48', currency_code: 'USD' },
      },
      payer_info: {
        payer_name: { alternate_full_name: 'StrackPac AI Agent' },
        email_address: 'sb-kcumg53769517@personal.example.com',
      },
    },
    retrievedAt: new Date(),
    createdAt: new Date('2026-11-07T03:19:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client1Id,
    paypalTransactionId: '55L55045LM1457946',
    transactionType: 'PAYMENT',
    status: 'COMPLETED',
    grossAmount: '1.00',
    grossCurrency: 'USD',
    feeAmount: '-0.52',
    feeCurrency: 'USD',
    feeSource: 'actual_paypal',
    paypalReportedNetAmount: '0.48',
    paypalReportedNetCurrency: 'USD',
    payleakCalculatedNetAmount: '0.48',
    payleakCalculatedNetCurrency: 'USD',
    netVerificationStatus: 'MATCH',
    netVerificationDifference: '0.00',
    netVerificationExplanation: 'PayPal-reported and PayLeak-calculated amounts match at the supported precision.',
    netVerificationReasons: [],
    transactionDate: new Date('2026-11-07T01:06:00Z'),
    financialDataStatus: 'complete',
    rawPaypal: {
      transaction_info: {
        transaction_id: '55L55045LM1457946',
        paypal_order_id: '91353905KU5638522',
        transaction_amount: { value: '1.00', currency_code: 'USD' },
        fee_amount: { value: '-0.52', currency_code: 'USD' },
        net_amount: { value: '0.48', currency_code: 'USD' },
      },
      payer_info: {
        payer_name: { alternate_full_name: 'StrackPac AI Agent' },
        email_address: 'sb-kcumg53769517@personal.example.com',
      },
    },
    retrievedAt: new Date(),
    createdAt: new Date('2026-11-07T01:06:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client2Id,
    paypalTransactionId: '40437426UC619353S',
    transactionType: 'PAYMENT',
    status: 'COMPLETED',
    grossAmount: '1.00',
    grossCurrency: 'USD',
    feeAmount: '-0.52',
    feeCurrency: 'USD',
    feeSource: 'actual_paypal',
    paypalReportedNetAmount: '0.48',
    paypalReportedNetCurrency: 'USD',
    payleakCalculatedNetAmount: '0.48',
    payleakCalculatedNetCurrency: 'USD',
    netVerificationStatus: 'MATCH',
    netVerificationDifference: '0.00',
    netVerificationExplanation: 'PayPal-reported and PayLeak-calculated amounts match at the supported precision.',
    netVerificationReasons: [],
    transactionDate: new Date('2026-11-07T01:05:00Z'),
    financialDataStatus: 'complete',
    rawPaypal: {
      transaction_info: {
        transaction_id: '40437426UC619353S',
        paypal_order_id: '7W987549BY564092B',
        transaction_amount: { value: '1.00', currency_code: 'USD' },
        fee_amount: { value: '-0.52', currency_code: 'USD' },
        net_amount: { value: '0.48', currency_code: 'USD' },
      },
      payer_info: {
        payer_name: { alternate_full_name: 'CrawlerPal AI Agent' },
        email_address: 'sb-kcumg53769517@personal.example.com',
      },
    },
    retrievedAt: new Date(),
    createdAt: new Date('2026-11-07T01:05:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client1Id,
    paypalTransactionId: '0CE95291KD544762C',
    transactionType: 'PAYMENT',
    status: 'COMPLETED',
    grossAmount: '1.00',
    grossCurrency: 'USD',
    feeAmount: '-0.52',
    feeCurrency: 'USD',
    feeSource: 'actual_paypal',
    paypalReportedNetAmount: '0.48',
    paypalReportedNetCurrency: 'USD',
    payleakCalculatedNetAmount: '0.48',
    payleakCalculatedNetCurrency: 'USD',
    netVerificationStatus: 'MATCH',
    netVerificationDifference: '0.00',
    netVerificationExplanation: 'PayPal-reported and PayLeak-calculated amounts match at the supported precision.',
    netVerificationReasons: [],
    transactionDate: new Date('2026-11-07T01:00:00Z'),
    financialDataStatus: 'complete',
    rawPaypal: {
      transaction_info: {
        transaction_id: '0CE95291KD544762C',
        paypal_order_id: '2HP01607381301242',
        transaction_amount: { value: '1.00', currency_code: 'USD' },
        fee_amount: { value: '-0.52', currency_code: 'USD' },
        net_amount: { value: '0.48', currency_code: 'USD' },
      },
      payer_info: {
        payer_name: { alternate_full_name: 'StrackPac AI Agent' },
        email_address: 'sb-kcumg53769517@personal.example.com',
      },
    },
    retrievedAt: new Date(),
    createdAt: new Date('2026-11-07T01:00:00Z'),
    updatedAt: new Date(),
  },
];

await db.collection('transactions').deleteMany({ userId });
await db.collection('transactions').insertMany(txList);

// 3. Seed Invoices
const invoices = [
  {
    userId,
    clientId: client1Id,
    client: 'StrackPac AI Agent',
    email: 'agent@strackpac.dev',
    customerName: 'StrackPac AI Agent',
    customerEmail: 'agent@strackpac.dev',
    invoiceNumber: 'INV-2026-001',
    amount: '100.00',
    currency: 'USD',
    totalAmount: '100.00',
    subtotal: '100.00',
    paymentAmount: '100.00',
    description: 'Autonomous API Gateway Credit Pack - 100 Credits',
    status: 'Paid',
    source: 'paypal',
    paypalStatus: 'PAID',
    paypalInvoiceId: 'INV2-R49X-Y47K-899A-4832',
    invoiceDate: new Date('2026-11-01T10:00:00Z'),
    dueDate: new Date('2026-11-15T10:00:00Z'),
    paymentDate: new Date('2026-11-07T03:45:00Z'),
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client2Id,
    client: 'CrawlerPal AI Agent',
    email: 'bot@crawlerpal.dev',
    customerName: 'CrawlerPal AI Agent',
    customerEmail: 'bot@crawlerpal.dev',
    invoiceNumber: 'INV-2026-002',
    amount: '50.00',
    currency: 'USD',
    totalAmount: '50.00',
    subtotal: '50.00',
    description: 'Pay-Per-Crawl Access License - Tier 2',
    status: 'Sent',
    source: 'payleak',
    invoiceDate: new Date('2026-11-05T12:00:00Z'),
    dueDate: new Date('2026-11-20T12:00:00Z'),
    createdAt: new Date('2026-11-05T12:00:00Z'),
    updatedAt: new Date(),
  },
  {
    userId,
    clientId: client3Id,
    client: 'Acme Research Labs',
    email: 'finance@acme.com',
    customerName: 'Acme Research Labs',
    customerEmail: 'finance@acme.com',
    invoiceNumber: 'INV-2026-003',
    amount: '250.00',
    currency: 'USD',
    totalAmount: '250.00',
    subtotal: '250.00',
    description: 'Enterprise Financial Analytics & Reconciliation Platform',
    status: 'Draft',
    source: 'payleak',
    invoiceDate: new Date('2026-11-08T09:00:00Z'),
    dueDate: new Date('2026-11-25T09:00:00Z'),
    createdAt: new Date('2026-11-08T09:00:00Z'),
    updatedAt: new Date(),
  },
];

await db.collection('invoices').deleteMany({ userId });
await db.collection('invoices').insertMany(invoices);

console.log('Seeded successfully:');
console.log(`- ${clients.length} Clients`);
console.log(`- ${txList.length} Real PayPal Transactions`);
console.log(`- ${invoices.length} Invoices`);

await mongoose.disconnect();


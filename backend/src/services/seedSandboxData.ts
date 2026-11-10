import { Types } from "mongoose";
import { env } from "../config/env.js";
import { Client } from "../models/Client.js";
import { Invoice } from "../models/Invoice.js";
import { PayPalAccount } from "../models/PayPalAccount.js";
import { Transaction } from "../models/Transaction.js";

export async function seedSandboxRecordsForUser(userId: string) {
  const userObjectId = new Types.ObjectId(userId);

  // 1. Ensure PayPalAccount exists and is marked connected
  const now = new Date();
  await PayPalAccount.findOneAndUpdate(
    { userId: userObjectId },
    {
      $set: {
        userId: userObjectId,
        payerId: "APP-8MJ48633R6276240N",
        email: env.PAYPAL_BUSINESS_EMAIL,
        environment: env.PAYPAL_MODE || "sandbox",
        connectedAt: now,
        lastSyncedAt: now,
        "capabilities.transactionSearch": true,
        "capabilities.invoicing": true,
        "capabilities.exchangeRateQuotes": true,
      },
    },
    { upsert: true, new: true },
  );

  // 2. Ensure Clients
  let clients = await Client.find({ userId: userObjectId });
  if (clients.length === 0) {
    const createdClients = await Client.create([
      { userId: userObjectId, name: "StrackPac AI Agent", email: "agent@strackpac.dev", company: "StrackPac Robotics" },
      { userId: userObjectId, name: "CrawlerPal AI Agent", email: "bot@crawlerpal.dev", company: "CrawlerPal Networks" },
      { userId: userObjectId, name: "Acme Research Labs", email: "finance@acme.com", company: "Acme Corp" },
    ]);
    clients = createdClients;
  }
  const client1Id = clients[0]?._id ?? null;
  const client2Id = clients[1]?._id ?? null;

  // 3. Ensure Transactions
  const existingTxCount = await Transaction.countDocuments({ userId: userObjectId });
  if (existingTxCount === 0) {
    await Transaction.create([
      {
        userId: userObjectId,
        clientId: client1Id,
        paypalTransactionId: "85Y91157RM5838030",
        transactionType: "PAYMENT",
        status: "COMPLETED",
        grossAmount: "1.00",
        grossCurrency: "USD",
        feeAmount: "-0.52",
        feeCurrency: "USD",
        feeSource: "actual_paypal",
        paypalReportedNetAmount: "0.48",
        paypalReportedNetCurrency: "USD",
        payleakCalculatedNetAmount: "0.48",
        payleakCalculatedNetCurrency: "USD",
        netVerificationStatus: "MATCH",
        netVerificationDifference: "0.00",
        netVerificationExplanation: "PayPal-reported and PayLeak-calculated amounts match at the supported precision.",
        netVerificationReasons: [],
        transactionDate: new Date("2026-11-07T03:45:00Z"),
        financialDataStatus: "complete",
        rawPaypal: {
          transaction_info: {
            transaction_id: "85Y91157RM5838030",
            paypal_order_id: "3WT58930C5815840M",
            transaction_amount: { value: "1.00", currency_code: "USD" },
            fee_amount: { value: "-0.52", currency_code: "USD" },
            net_amount: { value: "0.48", currency_code: "USD" },
          },
          payer_info: {
            payer_name: { alternate_full_name: "StrackPac AI Agent" },
            email_address: "sb-kcumg53769517@personal.example.com",
          },
        },
        retrievedAt: now,
      },
      {
        userId: userObjectId,
        clientId: client1Id,
        paypalTransactionId: "6PK69679MV007364R",
        transactionType: "PAYMENT",
        status: "COMPLETED",
        grossAmount: "1.00",
        grossCurrency: "USD",
        feeAmount: "-0.52",
        feeCurrency: "USD",
        feeSource: "actual_paypal",
        paypalReportedNetAmount: "0.48",
        paypalReportedNetCurrency: "USD",
        payleakCalculatedNetAmount: "0.48",
        payleakCalculatedNetCurrency: "USD",
        netVerificationStatus: "MATCH",
        netVerificationDifference: "0.00",
        netVerificationExplanation: "PayPal-reported and PayLeak-calculated amounts match at the supported precision.",
        netVerificationReasons: [],
        transactionDate: new Date("2026-11-07T03:19:00Z"),
        financialDataStatus: "complete",
        rawPaypal: {
          transaction_info: {
            transaction_id: "6PK69679MV007364R",
            paypal_order_id: "65N65520PW807883C",
            transaction_amount: { value: "1.00", currency_code: "USD" },
            fee_amount: { value: "-0.52", currency_code: "USD" },
            net_amount: { value: "0.48", currency_code: "USD" },
          },
          payer_info: {
            payer_name: { alternate_full_name: "StrackPac AI Agent" },
            email_address: "sb-kcumg53769517@personal.example.com",
          },
        },
        retrievedAt: now,
      },
      {
        userId: userObjectId,
        clientId: client1Id,
        paypalTransactionId: "55L55045LM1457946",
        transactionType: "PAYMENT",
        status: "COMPLETED",
        grossAmount: "1.00",
        grossCurrency: "USD",
        feeAmount: "-0.52",
        feeCurrency: "USD",
        feeSource: "actual_paypal",
        paypalReportedNetAmount: "0.48",
        paypalReportedNetCurrency: "USD",
        payleakCalculatedNetAmount: "0.48",
        payleakCalculatedNetCurrency: "USD",
        netVerificationStatus: "MATCH",
        netVerificationDifference: "0.00",
        netVerificationExplanation: "PayPal-reported and PayLeak-calculated amounts match at the supported precision.",
        netVerificationReasons: [],
        transactionDate: new Date("2026-11-07T01:06:00Z"),
        financialDataStatus: "complete",
        rawPaypal: {
          transaction_info: {
            transaction_id: "55L55045LM1457946",
            paypal_order_id: "91353905KU5638522",
            transaction_amount: { value: "1.00", currency_code: "USD" },
            fee_amount: { value: "-0.52", currency_code: "USD" },
            net_amount: { value: "0.48", currency_code: "USD" },
          },
          payer_info: {
            payer_name: { alternate_full_name: "StrackPac AI Agent" },
            email_address: "sb-kcumg53769517@personal.example.com",
          },
        },
        retrievedAt: now,
      },
      {
        userId: userObjectId,
        clientId: client2Id,
        paypalTransactionId: "40437426UC619353S",
        transactionType: "PAYMENT",
        status: "COMPLETED",
        grossAmount: "1.00",
        grossCurrency: "USD",
        feeAmount: "-0.52",
        feeCurrency: "USD",
        feeSource: "actual_paypal",
        paypalReportedNetAmount: "0.48",
        paypalReportedNetCurrency: "USD",
        payleakCalculatedNetAmount: "0.48",
        payleakCalculatedNetCurrency: "USD",
        netVerificationStatus: "MATCH",
        netVerificationDifference: "0.00",
        netVerificationExplanation: "PayPal-reported and PayLeak-calculated amounts match at the supported precision.",
        netVerificationReasons: [],
        transactionDate: new Date("2026-11-07T01:05:00Z"),
        financialDataStatus: "complete",
        rawPaypal: {
          transaction_info: {
            transaction_id: "40437426UC619353S",
            paypal_order_id: "7W987549BY564092B",
            transaction_amount: { value: "1.00", currency_code: "USD" },
            fee_amount: { value: "-0.52", currency_code: "USD" },
            net_amount: { value: "0.48", currency_code: "USD" },
          },
          payer_info: {
            payer_name: { alternate_full_name: "CrawlerPal AI Agent" },
            email_address: "sb-kcumg53769517@personal.example.com",
          },
        },
        retrievedAt: now,
      },
      {
        userId: userObjectId,
        clientId: client1Id,
        paypalTransactionId: "0CE95291KD544762C",
        transactionType: "PAYMENT",
        status: "COMPLETED",
        grossAmount: "1.00",
        grossCurrency: "USD",
        feeAmount: "-0.52",
        feeCurrency: "USD",
        feeSource: "actual_paypal",
        paypalReportedNetAmount: "0.48",
        paypalReportedNetCurrency: "USD",
        payleakCalculatedNetAmount: "0.48",
        payleakCalculatedNetCurrency: "USD",
        netVerificationStatus: "MATCH",
        netVerificationDifference: "0.00",
        netVerificationExplanation: "PayPal-reported and PayLeak-calculated amounts match at the supported precision.",
        netVerificationReasons: [],
        transactionDate: new Date("2026-11-07T01:00:00Z"),
        financialDataStatus: "complete",
        rawPaypal: {
          transaction_info: {
            transaction_id: "0CE95291KD544762C",
            paypal_order_id: "2HP01607381301242",
            transaction_amount: { value: "1.00", currency_code: "USD" },
            fee_amount: { value: "-0.52", currency_code: "USD" },
            net_amount: { value: "0.48", currency_code: "USD" },
          },
          payer_info: {
            payer_name: { alternate_full_name: "StrackPac AI Agent" },
            email_address: "sb-kcumg53769517@personal.example.com",
          },
        },
        retrievedAt: now,
      },
    ]);
  }

  // 4. Ensure Invoices
  const existingInvCount = await Invoice.countDocuments({ userId: userObjectId });
  if (existingInvCount === 0) {
    await Invoice.create([
      {
        userId: userObjectId,
        clientId: client1Id,
        client: "StrackPac AI Agent",
        email: "agent@strackpac.dev",
        customerName: "StrackPac AI Agent",
        customerEmail: "agent@strackpac.dev",
        invoiceNumber: "INV-2026-001",
        amount: "100.00",
        currency: "USD",
        totalAmount: "100.00",
        subtotal: "100.00",
        paymentAmount: "100.00",
        description: "Autonomous API Gateway Credit Pack - 100 Credits",
        status: "Paid",
        source: "paypal",
        paypalStatus: "PAID",
        paypalInvoiceId: "INV2-R49X-Y47K-899A-4832",
        invoiceDate: new Date("2026-11-01T10:00:00Z"),
        dueDate: new Date("2026-11-15T10:00:00Z"),
        paymentDate: new Date("2026-11-07T03:45:00Z"),
      },
      {
        userId: userObjectId,
        clientId: client1Id,
        client: "StrackPac AI Agent",
        email: "agent@strackpac.dev",
        customerName: "StrackPac AI Agent",
        customerEmail: "agent@strackpac.dev",
        invoiceNumber: "INV-2026-002",
        amount: "50.00",
        currency: "USD",
        totalAmount: "50.00",
        subtotal: "50.00",
        description: "Autonomous Agent Crawler Access Pass",
        status: "Sent",
        source: "paypal",
        paypalStatus: "SENT",
        paypalInvoiceId: "INV2-T33B-Z88M-120P-9914",
        invoiceDate: new Date("2026-11-05T12:00:00Z"),
        dueDate: new Date("2026-11-19T12:00:00Z"),
      },
      {
        userId: userObjectId,
        clientId: client2Id,
        client: "CrawlerPal AI Agent",
        email: "bot@crawlerpal.dev",
        customerName: "CrawlerPal AI Agent",
        customerEmail: "bot@crawlerpal.dev",
        invoiceNumber: "INV-2026-003",
        amount: "250.00",
        currency: "USD",
        totalAmount: "250.00",
        subtotal: "250.00",
        description: "Enterprise Monitored Endpoint Gateway - Q4",
        status: "Draft",
        source: "paypal",
        paypalStatus: "DRAFT",
        paypalInvoiceId: "INV2-M99K-L44X-776Y-3312",
        invoiceDate: new Date("2026-11-06T14:30:00Z"),
        dueDate: new Date("2026-11-20T14:30:00Z"),
      },
    ]);
  }
}


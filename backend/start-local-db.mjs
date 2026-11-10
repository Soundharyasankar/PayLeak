import { MongoMemoryServer } from 'mongodb-memory-server';

console.log('Starting local MongoDB server for PayLeak...');
const mongod = await MongoMemoryServer.create({
  instance: {
    port: 27017,
    dbName: 'payleak',
    ip: '127.0.0.1',
  },
});

console.log('MongoDB server ready on port 27017. Connection URI:', mongod.getUri());

// Keep process active indefinitely
setInterval(() => {}, 1000 * 60 * 60);


import { MemoryStore } from './memory-store.js';
import { runStoreContractTests } from '../testing/store-contract.js';

runStoreContractTests('MemoryStore', () => new MemoryStore());

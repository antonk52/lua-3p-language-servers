#!/usr/bin/env node

import {createConnection} from './stylua/connection.js';

const args = process.argv;

if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${require('../package.json').version}`);
    process.exit(0);
}

createConnection().then(x => x.listen());

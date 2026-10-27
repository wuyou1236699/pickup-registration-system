import { copyFile, writeFile } from 'node:fs/promises'
import pkg from '../package.json' with { type: 'json' }
await copyFile('cloudfunctions/pickup-api/package.json','dist/backend/cloudfunctions/pickup-api/package.json')
const target = { name:'pickup-api',version:'2.0.0',private:true,type:'commonjs',main:'index.js',engines:{node:'>=20'},dependencies:{mysql2:pkg.dependencies.mysql2} }
await writeFile('dist/backend/cloudfunctions/pickup-api/package.json',JSON.stringify(target,null,2)+'\n')
// Shared validation/handler modules live next to cloudfunctions in this candidate.
// Package the whole backend root, keeping the MySQL artifact separate from DocDB.
await writeFile('dist/backend/package.json',JSON.stringify({...target,main:'cloudfunctions/pickup-api/index.js'},null,2)+'\n')

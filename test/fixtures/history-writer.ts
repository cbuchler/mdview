import { HistoryStore } from '../../src/history.js'

const [directory, name] = process.argv.slice(2)
const store = new HistoryStore(directory)
for (let index = 0; index < 10; index++) {
  await store.remember({ kind: 'file', location: `/${name}-${index}`, title: name, openedAt: Date.now() })
}

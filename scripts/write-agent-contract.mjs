import { writeAgentContract } from '@ducking-mind/proxy-app-cli/agent-contract'

const [, , root = '.', destination = 'dist'] = process.argv
await writeAgentContract(root, destination)

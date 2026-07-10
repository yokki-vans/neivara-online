# Third-party notices

Project-owned code and content are covered by the repository [LICENSE](LICENSE). External packages retain their own licenses. `package-lock.json` is the canonical dependency/version record; CI also publishes a CycloneDX SBOM artifact for every verified revision.

Direct runtime and build dependencies inspected on 2026-07-10:

| Package | Resolved version | License |
|---|---:|---|
| @babylonjs/core | 9.16.1 | Apache-2.0 |
| @eslint/js | 10.0.1 | MIT |
| @fastify/cors | 11.3.0 | MIT |
| @fastify/helmet | 13.1.0 | MIT |
| @fastify/rate-limit | 11.1.0 | MIT |
| @types/node | 26.1.1 | MIT |
| @types/pg | 8.20.0 | MIT |
| @types/react | 19.2.17 | MIT |
| @types/react-dom | 19.2.3 | MIT |
| @vitejs/plugin-react | 6.0.3 | MIT |
| concurrently | 10.0.3 | MIT |
| dotenv | 17.4.2 | BSD-2-Clause |
| eslint | 10.6.0 | MIT |
| fastify | 5.10.0 | MIT |
| globals | 17.7.0 | MIT |
| jose | 6.2.3 | MIT |
| pg | 8.22.0 | MIT |
| pino-pretty | 13.1.3 | MIT |
| react | 19.2.7 | MIT |
| react-dom | 19.2.7 | MIT |
| socket.io | 4.8.3 | MIT |
| socket.io-client | 4.8.3 | MIT |
| tsx | 4.23.0 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| typescript-eslint | 8.63.0 | MIT |
| vite | 8.1.4 | MIT |
| vitest | 4.1.10 | MIT |
| zod | 4.4.3 | MIT |

License texts are distributed inside the corresponding npm packages and linked from their package metadata. Before a commercial release, regenerate the SBOM, review every transitive component and preserve any package-specific NOTICE files required by Apache-2.0 or other licenses.

## Third-party assets

### KayKit Adventurers 1.0

- Creator: Kay Lousberg
- Upstream: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- License: Creative Commons Zero 1.0 Universal (CC0 1.0)
- Local license: `third_party/kaykit/adventurers/LICENSE.txt`

Neivara uses modified portions of the character topology, rigs, animations,
clothing and equipment. The shipped runtime roster is rebuilt in Blender with
only six gameplay clips, selected class equipment, Neivara race palettes and
proportions, plus original race-signature meshes.

CC0 does not require attribution. This notice is retained voluntarily for clear
provenance and reproducible compliance review.

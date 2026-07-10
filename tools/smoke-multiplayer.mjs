import { randomBytes, randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "@neivara/shared";
import { io } from "socket.io-client";

const baseUrl = (process.env.API_URL ?? "http://localhost:3001").replace(/\/$/, "");

function letters(length = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function request(path, init = {}, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.message ?? "request failed"}`);
  return body;
}

async function createPlayer(label, race, gender, classId) {
  const suffix = randomBytes(5).toString("hex");
  const auth = await request("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: `smk_${label}_${suffix}`, password: "strong-smoke-password" }),
  });
  const created = await request(
    "/v1/characters",
    {
      method: "POST",
      body: JSON.stringify({ name: `${label}${letters()}`, race, gender, classId }),
    },
    auth.token,
  );
  return { token: auth.token, character: created.character };
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 6_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function connect(player) {
  const socket = io(baseUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: {
      token: player.token,
      characterId: player.character.id,
      protocolVersion: PROTOCOL_VERSION,
    },
  });
  const ready = waitFor(socket, "world:ready");
  const connected = waitFor(socket, "connect");
  socket.connect();
  return Promise.all([connected, ready]).then(() => socket);
}

const first = await createPlayer("Alder", "human", "female", "mage");
const second = await createPlayer("Birch", "orc", "male", "warrior");
if (
  first.character.gender !== "female"
  || first.character.race !== "human"
  || first.character.classId !== "mage"
) {
  throw new Error("Character identity was not persisted in the creation response");
}

const initialInventory = await request(
  `/v1/characters/${first.character.id}/inventory`,
  {},
  first.token,
);
if (initialInventory.inventory.items.length !== 8 || initialInventory.inventory.usedSlots !== 8) {
  throw new Error("Starter inventory was not granted exactly once");
}
const starterWeapon = initialInventory.inventory.equipment.main_hand;
if (!starterWeapon || !initialInventory.equipment.main_hand) {
  throw new Error("Starter weapon was not auto-equipped");
}
const attackWithWeapon = initialInventory.derivedStats.spellPower;
const unequipped = await request(
  `/v1/characters/${first.character.id}/equipment/main_hand/unequip`,
  { method: "POST", body: "{}" },
  first.token,
);
if (unequipped.inventory.equipment.main_hand || unequipped.derivedStats.spellPower >= attackWithWeapon) {
  throw new Error("Unequip did not remove the weapon stat contribution");
}
const reequipped = await request(
  `/v1/characters/${first.character.id}/inventory/${starterWeapon.instanceId}/equip`,
  { method: "POST", body: "{}" },
  first.token,
);
if (
  reequipped.inventory.equipment.main_hand?.instanceId !== starterWeapon.instanceId
  || reequipped.derivedStats.spellPower !== attackWithWeapon
) {
  throw new Error("Equip did not restore the authoritative loadout and stats");
}
const starterTonic = reequipped.inventory.items.find((item) => item.itemId === "field_tonic");
if (!starterTonic) throw new Error("Starter consumable is missing");
const afterConsumable = await request(
  `/v1/characters/${first.character.id}/inventory/${starterTonic.instanceId}/use`,
  {
    method: "POST",
    body: JSON.stringify({ quantity: 1 }),
    headers: { "Idempotency-Key": randomUUID() },
  },
  first.token,
);
if (
  afterConsumable.inventory.items.find((item) => item.instanceId === starterTonic.instanceId)?.quantity
    !== starterTonic.quantity - 1
) {
  throw new Error("Consumable quantity was not decremented authoritatively");
}

const socketA = await connect(first);
const socketB = await connect(second);

try {
  const bothVisibleA = waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => snapshot.players.some((player) => player.id === second.character.id),
  );
  const bothVisibleB = waitFor(
    socketB,
    "world:snapshot",
    (snapshot) => snapshot.players.some((player) => player.id === first.character.id),
  );
  const [snapshotA, snapshotB] = await Promise.all([bothVisibleA, bothVisibleB]);

  const chatReceived = waitFor(
    socketB,
    "chat:message",
    (message) => message.senderId === first.character.id && message.text === "multiplayer-smoke-ok",
  );
  socketA.emit("chat:send", { text: "multiplayer-smoke-ok" });
  await chatReceived;

  const initial = snapshotA.players.find((player) => player.id === first.character.id).position.x;
  const moved = waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => {
      const player = snapshot.players.find((entry) => entry.id === first.character.id);
      return Boolean(player && player.position.x > initial + 0.2);
    },
  );
  socketA.emit("world:input", {
    seq: 1,
    direction: { x: 1, z: 0 },
    facing: Math.PI / 2,
    sprint: false,
  });
  const movedSnapshot = await moved;
  socketA.emit("world:input", {
    seq: 2,
    direction: { x: 0, z: 0 },
    facing: Math.PI / 2,
    sprint: false,
  });
  const finalX = movedSnapshot.players.find((player) => player.id === first.character.id).position.x;

  const combatSnapshot = await waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => snapshot.monsters.some((monster) => monster.alive && !monster.elite),
  );
  const selfBeforeCombat = combatSnapshot.players.find((player) => player.id === first.character.id);
  const targetMonster = combatSnapshot.monsters
    .filter((monster) => monster.alive && !monster.elite)
    .sort((a, b) => {
      const distanceA = Math.hypot(a.position.x - selfBeforeCombat.position.x, a.position.z - selfBeforeCombat.position.z);
      const distanceB = Math.hypot(b.position.x - selfBeforeCombat.position.x, b.position.z - selfBeforeCombat.position.z);
      return distanceA - distanceB;
    })[0];
  const dx = targetMonster.position.x - selfBeforeCombat.position.x;
  const dz = targetMonster.position.z - selfBeforeCombat.position.z;
  const directionLength = Math.hypot(dx, dz);
  const combatRangeReached = waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => {
      const player = snapshot.players.find((entry) => entry.id === first.character.id);
      const monster = snapshot.monsters.find((entry) => entry.id === targetMonster.id);
      return Boolean(player && monster && Math.hypot(
        player.position.x - monster.position.x,
        player.position.z - monster.position.z,
      ) <= 10.5);
    },
  );
  socketA.emit("world:input", {
    seq: 3,
    direction: { x: dx / directionLength, z: dz / directionLength },
    facing: Math.atan2(dx, dz),
    sprint: true,
  });
  await combatRangeReached;
  socketA.emit("world:input", {
    seq: 4,
    direction: { x: 0, z: 0 },
    facing: Math.atan2(dx, dz),
    sprint: false,
  });
  socketA.emit("world:target", { targetId: targetMonster.id });

  const defeated = waitFor(
    socketA,
    "combat:event",
    (event) => event.kind === "defeat" && event.targetId === targetMonster.id,
    10_000,
  );
  const questAdvanced = waitFor(
    socketA,
    "quest:update",
    (progress) => progress.current >= 1,
    10_000,
  );
  const xpAdvanced = waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => snapshot.players.some(
      (player) => player.id === first.character.id && player.xp > 0,
    ),
    10_000,
  );
  const lootAppeared = waitFor(
    socketA,
    "world:snapshot",
    (snapshot) => snapshot.loot.some((drop) => drop.ownerId === first.character.id),
    10_000,
  );

  socketA.emit("combat:use", {
    seq: 10,
    abilityId: "aether_bolt",
    targetId: targetMonster.id,
  });
  for (let index = 0; index < 7; index += 1) {
    socketA.emit("combat:use", {
      seq: 11 + index,
      abilityId: "basic",
      targetId: targetMonster.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_050));
  }

  const [, questResult, xpResult, lootResult] = await Promise.all([
    defeated,
    questAdvanced,
    xpAdvanced,
    lootAppeared,
  ]);
  const ownedDrop = lootResult.loot.find((drop) => drop.ownerId === first.character.id);
  const playerAtDrop = lootResult.players.find((player) => player.id === first.character.id);
  const lootDx = ownedDrop.position.x - playerAtDrop.position.x;
  const lootDz = ownedDrop.position.z - playerAtDrop.position.z;
  const lootDirectionLength = Math.hypot(lootDx, lootDz);
  if (lootDirectionLength > 2.5) {
    const lootRangeReached = waitFor(
      socketA,
      "world:snapshot",
      (snapshot) => {
        const player = snapshot.players.find((entry) => entry.id === first.character.id);
        const drop = snapshot.loot.find((entry) => entry.id === ownedDrop.id);
        return Boolean(player && drop && Math.hypot(
          player.position.x - drop.position.x,
          player.position.z - drop.position.z,
        ) <= 2.5);
      },
    );
    socketA.emit("world:input", {
      seq: 100,
      direction: { x: lootDx / lootDirectionLength, z: lootDz / lootDirectionLength },
      facing: Math.atan2(lootDx, lootDz),
      sprint: true,
    });
    await lootRangeReached;
    socketA.emit("world:input", {
      seq: 101,
      direction: { x: 0, z: 0 },
      facing: Math.atan2(lootDx, lootDz),
      sprint: false,
    });
  }
  const inventoryUpdated = waitFor(
    socketA,
    "inventory:update",
    (payload) => payload.inventory.some((item) => item.itemId === ownedDrop.itemId),
  );
  socketA.emit("loot:pickup", { lootId: ownedDrop.id });
  const inventoryResult = await inventoryUpdated;
  const xpResultPlayer = xpResult.players.find((player) => player.id === first.character.id);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const persistedRoster = await request("/v1/characters", {}, first.token);
  const persistedDetails = await request(
    `/v1/characters/${first.character.id}/inventory`,
    {},
    first.token,
  );
  const persistedCharacter = persistedRoster.characters.find(
    (entry) => entry.id === first.character.id,
  );
  if (!persistedCharacter || persistedCharacter.xp < xpResultPlayer.xp) {
    throw new Error("Character progression was not persisted");
  }
  if (persistedCharacter.gender !== "female") {
    throw new Error("Character gender was not persisted in the roster");
  }
  if (!persistedDetails.inventory.items.some((item) => item.itemId === ownedDrop.itemId)) {
    throw new Error("Inventory was not persisted");
  }
  if (persistedDetails.quest.current < questResult.current) {
    throw new Error("Quest progress was not persisted");
  }

  console.log(JSON.stringify({
    ok: true,
    server: baseUrl,
    playersVisibleToA: snapshotA.players.length,
    playersVisibleToB: snapshotB.players.length,
    chat: "received",
    inventory: "starter grant, equip, unequip and consumable verified",
    authoritativeMovementDelta: Number((finalX - initial).toFixed(3)),
    pve: "monster defeated",
    xpAwarded: xpResultPlayer.xp,
    questProgress: `${questResult.current}/${questResult.required}`,
    lootPickedUp: inventoryResult.inventory.find((item) => item.itemId === ownedDrop.itemId),
    persistence: "progress, quest and inventory reloaded from storage",
  }, null, 2));
} finally {
  socketA.disconnect();
  socketB.disconnect();
}

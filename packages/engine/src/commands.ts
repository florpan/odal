import { clampToMap, say, setTask } from './ctx';
import type { Ctx } from './ctx';
import { makeBuilding } from './entities';
import { stampFootprint } from './grid';
import { hexCentre } from './hex';
import type { PlayerCommand } from './protocol';
import {
  buildingUnlocked,
  canAfford,
  canPlaceBuilding,
  countBuildings,
  hasAbility,
  hasTech,
  isTechQueued,
  missingRequirement,
  pay,
  popCap,
  popUsed,
  refund,
  techUnlocked,
  unitUnlocked,
  upgradeUnlocked,
} from './queries';
import { describeRequirement } from './tree';
import type { Unit } from './types';

// ---------------------------------------------------------------------------
// Commands: validate a player's request against the rules and turn it into
// unit tasks or queue entries. Every rejection is a message, never a crash.
// ---------------------------------------------------------------------------

export function applyCommand(ctx: Ctx, pc: PlayerCommand) {
  const { state, tree, defs } = ctx;
  const player = state.players[pc.playerId];
  if (!player) return;
  const cmd = pc.cmd;
  const units =
    'unitIds' in cmd && Array.isArray(cmd.unitIds)
      ? cmd.unitIds.map((id) => state.units[id]).filter((u): u is Unit => !!u && u.owner === player.id)
      : [];
  const builders = units.filter((u) => hasAbility(tree, u, 'build'));

  switch (cmd.type) {
    case 'move':
      for (const u of units) setTask(u, { kind: 'move', target: clampToMap(state, cmd.target) });
      break;

    case 'attackMove':
      for (const u of units) setTask(u, { kind: 'attackMove', target: clampToMap(state, cmd.target) });
      break;

    case 'stop':
      for (const u of units) setTask(u, { kind: 'idle' });
      break;

    case 'harvest': {
      const node = state.nodes[cmd.nodeId];
      if (!node) return;
      const resource = defs.nodes[node.type].resource;
      for (const u of units) {
        if (!hasAbility(tree, u, 'harvest')) {
          setTask(u, { kind: 'move', target: hexCentre(node.x, node.y) });
          continue;
        }
        const goDropFirst = !!u.carry && u.carry.type !== resource;
        setTask(u, {
          kind: 'harvest',
          nodeId: node.id,
          nodeType: node.type,
          phase: goDropFirst ? 'toDrop' : 'toNode',
          progress: 0,
        });
      }
      break;
    }

    case 'build': {
      const def = defs.buildings[cmd.building];
      if (!def || !builders.length) return;
      if (!buildingUnlocked(state, player, cmd.building)) {
        const req = missingRequirement(state, player, def.requires);
        say(
          ctx,
          player.id,
          req ? `${def.name} requires ${describeRequirement(tree, req)}.` : `${def.name} cannot be built.`,
        );
        return;
      }
      if (
        !Number.isInteger(cmd.x) ||
        !Number.isInteger(cmd.y) ||
        !canPlaceBuilding(state, ctx.blocked, cmd.building, cmd.x, cmd.y)
      ) {
        say(ctx, player.id, `Cannot build there.`);
        return;
      }
      if (def.limit !== undefined && countBuildings(state, player.id, cmd.building) >= def.limit) {
        say(
          ctx,
          player.id,
          def.limit === 1 ? `Only one ${def.name} allowed.` : `Only ${def.limit} of ${def.name} allowed.`,
        );
        return;
      }
      if (!canAfford(player.resources, def.cost)) {
        say(ctx, player.id, `Not enough resources for ${def.name}.`);
        return;
      }
      pay(player.resources, def.cost);
      const b = makeBuilding(state, player.id, cmd.building, cmd.x, cmd.y);
      // Mark the footprint blocked right away so later commands this tick see it.
      stampFootprint(ctx.blocked, state.width, state.height, b.x, b.y, b.r, 1);
      for (const u of builders) setTask(u, { kind: 'build', buildingId: b.id });
      break;
    }

    case 'assist': {
      const b = state.buildings[cmd.buildingId];
      if (!b || b.owner !== player.id || b.progress >= 1) return;
      for (const u of builders) setTask(u, { kind: 'build', buildingId: b.id });
      break;
    }

    case 'attack': {
      const target = cmd.targetKind === 'unit' ? state.units[cmd.targetId] : state.buildings[cmd.targetId];
      if (!target || target.owner === player.id) return;
      for (const u of units) {
        if (hasAbility(tree, u, 'attack')) {
          setTask(u, { kind: 'attack', targetId: cmd.targetId, targetKind: cmd.targetKind });
        } else {
          setTask(u, {
            kind: 'move',
            target: cmd.targetKind === 'unit' ? { x: target.x, y: target.y } : hexCentre(target.x, target.y),
          });
        }
      }
      break;
    }

    case 'train': {
      const b = state.buildings[cmd.buildingId];
      const def = defs.units[cmd.unit];
      if (!b || !def || b.owner !== player.id || b.progress < 1) return;
      if (!defs.buildings[b.type].trains.includes(cmd.unit)) return;
      if (!unitUnlocked(state, player, cmd.unit)) {
        const req = missingRequirement(state, player, def.requires)!;
        say(ctx, player.id, `${def.name} requires ${describeRequirement(tree, req)}.`);
        return;
      }
      if (b.queue.length >= tree.rules.maxQueue) {
        say(ctx, player.id, `Queue is full.`);
        return;
      }
      if (popUsed(state, player.id) + def.pop > popCap(state, player.id)) {
        say(ctx, player.id, `Not enough housing.`);
        return;
      }
      if (!canAfford(player.resources, def.cost)) {
        say(ctx, player.id, `Not enough resources for ${def.name}.`);
        return;
      }
      pay(player.resources, def.cost);
      b.queue.push({ kind: 'unit', type: cmd.unit });
      break;
    }

    case 'research': {
      const def = defs.techs[cmd.tech];
      if (!def) return;
      if (hasTech(player, cmd.tech) || isTechQueued(state, player.id, cmd.tech)) return;
      if (!techUnlocked(state, player, cmd.tech)) {
        const req = missingRequirement(state, player, def.requires)!;
        say(ctx, player.id, `${def.name} requires ${describeRequirement(tree, req)}.`);
        return;
      }
      if (player.research.length >= tree.rules.maxQueue) {
        say(ctx, player.id, `Research queue is full.`);
        return;
      }
      if (!canAfford(player.resources, def.cost)) {
        say(ctx, player.id, `Not enough resources for ${def.name}.`);
        return;
      }
      pay(player.resources, def.cost);
      player.research.push(cmd.tech);
      break;
    }

    case 'cancelResearch': {
      const id = player.research[cmd.index];
      if (id === undefined) return;
      refund(player.resources, defs.techs[id].cost);
      player.research.splice(cmd.index, 1);
      if (cmd.index === 0) player.researchProgress = 0;
      break;
    }

    case 'upgrade': {
      const b = state.buildings[cmd.buildingId];
      const def = defs.buildings[cmd.building];
      if (!b || !def || b.owner !== player.id) return;
      if (!defs.buildings[b.type].upgrades.includes(cmd.building) || b.progress < 1) return;
      if (b.queue.some((q) => q.kind === 'upgrade')) return;
      if (!upgradeUnlocked(state, player, b, cmd.building)) {
        const req = missingRequirement(state, player, def.requires);
        if (req) say(ctx, player.id, `${def.name} requires ${describeRequirement(tree, req)}.`);
        return;
      }
      if (b.queue.length >= tree.rules.maxQueue) {
        say(ctx, player.id, `Queue is full.`);
        return;
      }
      if (!canAfford(player.resources, def.cost)) {
        say(ctx, player.id, `Not enough resources for ${def.name}.`);
        return;
      }
      pay(player.resources, def.cost);
      b.queue.push({ kind: 'upgrade', type: cmd.building });
      break;
    }

    case 'cancelQueue': {
      const b = state.buildings[cmd.buildingId];
      if (!b || b.owner !== player.id) return;
      const item = b.queue[cmd.index];
      if (!item) return;
      refund(player.resources, item.kind === 'unit' ? defs.units[item.type].cost : defs.buildings[item.type].cost);
      b.queue.splice(cmd.index, 1);
      if (cmd.index === 0) b.queueProgress = 0;
      break;
    }

    case 'setRally': {
      const b = state.buildings[cmd.buildingId];
      if (!b || b.owner !== player.id || !defs.buildings[b.type].trains.length) return;
      if (!cmd.target) {
        b.rally = null;
        return;
      }
      const p = clampToMap(state, cmd.target);
      const nodeId = cmd.target.nodeId !== undefined && state.nodes[cmd.target.nodeId] ? cmd.target.nodeId : undefined;
      b.rally = nodeId !== undefined ? { x: p.x, y: p.y, nodeId } : { x: p.x, y: p.y };
      break;
    }

    case 'rotate': {
      const b = state.buildings[cmd.buildingId];
      if (!b || b.owner !== player.id || !Number.isInteger(cmd.rot)) return;
      b.rot = ((cmd.rot % 6) + 6) % 6;
      break;
    }
  }
}

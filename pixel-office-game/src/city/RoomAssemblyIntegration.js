/**
 * Integration module for Room Assembly System with Phaser Scene
 * 
 * This module loads and initializes the RoomAssembly system, 
 * making it available in the OfficeScene.
 */

import { RoomAssembly } from './src/city/RoomAssembly.js';

export function initializeRoomAssembly(scene) {
  // Load assembly system and templates if not already loaded
  scene.load.json('spriteAssembly', './data/sprite-assembly-system.json');
  scene.load.json('roomTemplates', './data/room-templates.json');
}

export function createRoomAssemblyInstance(scene) {
  const spriteAssembly = scene.cache.json.get('spriteAssembly');
  const roomTemplates = scene.cache.json.get('roomTemplates');

  if (!spriteAssembly || !roomTemplates) {
    console.error('❌ Failed to load sprite assembly or room templates');
    return null;
  }

  const assembly = new RoomAssembly(scene, spriteAssembly, roomTemplates);
  assembly.initializeSpriteRegistry();

  console.log('✅ RoomAssembly initialized');
  return assembly;
}

export function renderRoomByName(assembly, templateName, options = {}) {
  if (!assembly) {
    console.error('❌ RoomAssembly not initialized');
    return null;
  }

  const room = assembly.renderRoom(templateName, {
    debug: true,
    ...options
  });

  if (room) {
    console.log(`✅ Room "${room.name}" rendered`);
    const stats = assembly.getRoomStats(templateName);
    console.table(stats);
    return room;
  }

  return null;
}

// The window's panels (App.jsx): the helpers, /web, /mcp, /hooks, pictures, /settings, /rewind,
// /permissions, /effort and its limits, and the choices they save.
// The functions are the App's own, moved word for word into one file a topic (panels-*.mjs): the App's names
// (and App.jsx's) are read through self, which App makes at each render, so a function sees the values of the
// render that made it. A part reads another part's names through own, which this file fills in order.
import { panelsHelpers } from './panels-helpers.mjs';
import { panelsWeb } from './panels-web.mjs';
import { panelsMcp } from './panels-mcp.mjs';
import { panelsHooks } from './panels-hooks.mjs';
import { panelsPictures } from './panels-pictures.mjs';
import { panelsSettings } from './panels-settings.mjs';
import { panelsRewind } from './panels-rewind.mjs';
import { panelsPermissions } from './panels-permissions.mjs';
import { panelsEffort } from './panels-effort.mjs';
import { panelsMachine } from './panels-machine.mjs';

export function panelsPart(self) {
  const own = {};
  Object.assign(own, panelsHelpers(self, own));
  Object.assign(own, panelsWeb(self, own));
  Object.assign(own, panelsMcp(self, own));
  Object.assign(own, panelsHooks(self, own));
  Object.assign(own, panelsPictures(self, own));
  Object.assign(own, panelsSettings(self, own));
  Object.assign(own, panelsRewind(self, own));
  Object.assign(own, panelsPermissions(self, own));
  Object.assign(own, panelsEffort(self, own));
  Object.assign(own, panelsMachine(self, own));
  const { applyHelpers, serviceOf, serviceProps, pickHere, openWebPicker, runWebTest, saveWeb, offerList, openMcpPicker, mcpKeys, hooksList, hooksKeys, mcpNews, seeingModels, needVision, openSettings, openRewind, chooseRewind, applyRewind, openPermissions, memoryForRestart, openEffortLimits, openOwnSettings, fillSuggested, sharedValues, saveOwnSettings, keepOwnSettings, applyChoice, sayEffort, saveEffortLimits, setThinkingFn, readMacMemory, readServicePs, saveNowFn } = own;
  return { applyHelpers, serviceOf, serviceProps, pickHere, openWebPicker, runWebTest, saveWeb, offerList, openMcpPicker, mcpKeys, hooksList, hooksKeys, mcpNews, seeingModels, needVision, openSettings, openRewind, chooseRewind, applyRewind, openPermissions, memoryForRestart, openEffortLimits, openOwnSettings, fillSuggested, sharedValues, saveOwnSettings, keepOwnSettings, applyChoice, sayEffort, saveEffortLimits, setThinkingFn, readMacMemory, readServicePs, saveNowFn };
}

// The window's panels, pictures: the model's vision add-on (app-panels.mjs puts the parts together).
// Moved from app-panels.mjs word for word; a name from another part is read through own.
import { existsSync } from 'node:fs';
import { MODELS, modelPath, visionPath, remoteLabel, withVision } from '../../../models/index.mjs';

export function panelsPictures(self, own) {
  // ---- pictures: the model's vision add-on, loaded when a picture is first attached ----
  // The other models on this Mac that can look at pictures (their file and their add-on here).
  const seeingModels = () => Object.values(MODELS).filter((m) => m.id !== self.model.id && m.vision && existsSync(modelPath(m)) && existsSync(visionPath(m)));
  // true: the message waits (vision turning on, or a question about downloading it);
  // false: it goes now (text only, with a note why).
  const needVision = (value, shown) => {
    // A Pictures helper on the service (/subagents) describes it; the message goes now.
    if (self.model.remote && self.agent.helperUse?.('pictures')) return false;
    if (self.model.remote) { self.push({ type: 'note', text: `The remote model (${remoteLabel(self.settings.remote)}) cannot look at pictures${self.model.remote.kind === 'llama' ? ': its coding serve has no vision add-on (coding setup there gets it)' : ''}. The message goes with a line saying so.`, tone: 'warn' }); return false; }
    if (self.opts.url) { self.push({ type: 'note', text: 'The model server given with --url is not looking at pictures (start it with its --mmproj file). The message goes with a line saying so.', tone: 'warn' }); return false; }
    if (!self.model.vision) {
      // Another model on this Mac can: you are asked whether it takes this message.
      if (seeingModels().length) { self.visionWaitRef.current = { value, shown }; self.openChoice('vision-switch'); return true; }
      self.push({ type: 'note', text: `${self.model.name} cannot look at pictures. The message goes with a line saying so.`, tone: 'warn' });
      return false;
    }
    self.visionWaitRef.current = { value, shown };
    if (!existsSync(visionPath(self.model))) { self.openChoice('vision-get'); return true; }
    turnVisionOn();
    return true;
  };
  const turnVisionOn = async () => {
    const wait = self.visionWaitRef.current;
    self.push({ type: 'note', text: `Turning on ${self.model.name}'s vision: a reload of about 20 s (the conversation stays). Your message goes as soon as it can see.`, tone: 'dim' });
    await self.switchModel(withVision(self.model), () => `${self.model.name} can look at pictures now: it stays on for this window.`);
    self.visionWaitRef.current = null;
    if (wait) setTimeout(() => self.remoteFnRef.current.send?.(wait.value, wait.shown, { visionAsked: true }), 50);
  };
  return { seeingModels, needVision, turnVisionOn };
}

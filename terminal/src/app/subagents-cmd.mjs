// /subagents <model> (28 Oct 2026): the helpers the Agent tool starts run on that model, on the conversation's own
// service (profiles.mjs helpersTo); from the next message the conversation's model is offered the Agent tool
// (agent.mjs helpersElsewhere). /subagents alone still opens /profiles on its AIs group (slash-model.mjs).
import { endpointOf, ollamaCatalog } from '../../../models/index.mjs';
import { helpersTo, readProfiles, serverOf, writeProfiles } from './profiles.mjs';

export async function useHelperModel(self, model) {
  const say = (text, tone = 'dim') => self.push({ type: 'note', text, tone });
  const remote = self.model?.remote;
  if (!remote) { say(`/subagents <model> picks a model on a service for the helpers; ${self.model?.name ?? 'this model'} runs on this Mac, so its helpers run on it. /subagents alone opens /profiles.`, 'warn'); return false; }
  const ep = endpointOf(self.agent?.url);
  if (ep?.ollama) {
    const list = await ollamaCatalog({ url: self.agent.url, key: ep.key }).catch(() => null);
    const names = list?.models?.map((m) => m.id) ?? [];
    if (names.length && !names.includes(model)) {
      const near = names.filter((n) => n.split(':')[0] === model.split(':')[0]);
      say(`The service has no ${model}${near.length ? `; it has ${near.join(', ')}` : ''}. ollama pull ${model} gets it.`, 'warn');
      return false;
    }
  }
  if (model === self.agent?.modelName?.()) { say(`${model} is the conversation's own model: helpers on it change nothing. Pick a smaller one, such as bonsai-2:4b.`, 'warn'); return false; }
  const data = readProfiles(self.settings);
  const server = data.profiles[data.uses['ai:main']]?.server ?? serverOf(self.settings?.remote);
  const r = helpersTo(data, model, server);
  writeProfiles(r.data);
  // The conversation looks at its helpers once (agent.mjs helpersElsewhere): this makes its next message look again.
  if (self.agent) self.agent.helpersAway = null;
  say(`Helpers it starts → ${model} ("${r.name}"${r.made ? ', made now' : ''}). From the next message ${self.agent?.modelName?.() ?? 'the model'} has the Agent tool and hands reading and searching to it; side jobs: /profiles.`);
  return true;
}

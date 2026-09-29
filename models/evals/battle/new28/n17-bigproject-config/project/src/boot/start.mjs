import { loadSettings } from './loadSettings.mjs';
import { makeApp } from '../web/app.mjs';

const settings = loadSettings();
makeApp().listen(settings.listenPort);

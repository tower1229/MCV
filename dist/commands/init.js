"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRepository = initRepository;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const yaml = __importStar(require("yaml"));
const state_1 = require("../utils/state");
function initRepository(targetDir = process.cwd()) {
    const manifestPath = path.join(targetDir, 'mcv.yaml');
    if (fs.existsSync(manifestPath)) {
        console.log('An mcv.yaml manifest already exists in this directory.');
        console.log('You might want to run `mcv bind` instead to bind this existing repository to your device.');
        return;
    }
    const repoId = (0, uuid_1.v4)();
    const manifest = {
        schemaVersion: 1,
        repository: {
            id: repoId,
            initializedAt: new Date().toISOString()
        }
    };
    const yamlStr = yaml.stringify(manifest);
    fs.writeFileSync(manifestPath, yamlStr, 'utf-8');
    console.log(`Initialized empty MCV repository in ${targetDir}`);
    console.log(`Repository ID: ${repoId}`);
    // Bind the repository to local state
    const state = (0, state_1.readState)();
    state.defaultRepository = {
        id: repoId,
        path: targetDir
    };
    (0, state_1.writeState)(state);
    console.log('Successfully bound current device to this MCV repository.');
}

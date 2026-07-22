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
function initRepository(context, targetDir = process.cwd()) {
    const repositoryPath = path.resolve(targetDir);
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    if (fs.existsSync(manifestPath)) {
        console.log('An mcv.yaml manifest already exists in this directory.');
        console.log('You might want to run `mcv bind` instead to bind this existing repository to your device.');
        return false;
    }
    const repositoryId = (0, uuid_1.v4)();
    const initializedAt = new Date().toISOString();
    const manifest = {
        schemaVersion: 2,
        repositoryId,
        initializedAt,
        targets: {
            codex: { enabled: true },
            claudeCode: { enabled: true },
            gemini: {
                enabled: true,
                surfaces: { geminiCli: 'auto', antigravity: 'auto' },
            },
        },
        variables: {},
        security: {
            scanSecrets: true,
            allowPlaintextSecrets: false,
        },
        capture: {
            preserveUnknownNativeFields: true,
        },
        deploy: {
            backupBeforeWrite: true,
            useSymlinks: false,
        },
    };
    const yamlStr = yaml.stringify(manifest);
    fs.writeFileSync(manifestPath, yamlStr, 'utf-8');
    console.log(`Initialized empty MCV repository in ${repositoryPath}`);
    console.log(`Repository ID: ${repositoryId}`);
    const state = (0, state_1.readState)(context);
    state.schemaVersion = 2;
    state.deviceId ??= (0, uuid_1.v4)();
    state.defaultRepositoryId = repositoryId;
    state.repositoryPath = repositoryPath;
    state.baselineSnapshot = {
        recordedAt: initializedAt,
        files: {},
    };
    (0, state_1.writeState)(context, state);
    console.log('Successfully bound current device to this MCV repository.');
    return true;
}

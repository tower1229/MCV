"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderJson = renderJson;
function renderJson(contract) {
    return JSON.stringify(contract, null, 2);
}

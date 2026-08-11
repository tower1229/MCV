export function renderJson(contract) {
    return JSON.stringify(contract, null, 2);
}
export function presentJson(contract) {
    console.log(renderJson(contract));
}

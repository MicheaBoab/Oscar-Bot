// Shared by deployment and runtime. Legacy modules remain available to message handlers.
const names = Object.freeze(['control', 'manual', 'ping', 'refresh']);
function loadCommands() {
  return names.map(name => require(`../commands/${name}`));
}
module.exports = { names, loadCommands };

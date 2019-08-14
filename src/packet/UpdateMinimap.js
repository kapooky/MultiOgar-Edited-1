// Import
var BinaryWriter = require("./BinaryWriter");

function updateMinimap(playerTracker, leaderboard, leaderboardType) {
    this.playerTracker = playerTracker;
    this.leaderboard = leaderboard;
    this.leaderboardType = leaderboardType;
    this.allClients = playerTracker.gameServer.clients;
    this.leaderboardCount = Math.min(leaderboard.length, playerTracker.gameServer.config.serverMaxLB);
}
module.exports = updateMinimap;
updateMinimap.prototype.build = function (protocol) {
    switch (this.leaderboardType) {

        case 50:
            // Team
            //send a modified version of another packet

            return this.sendTeamPacket();
        default:
            return null;
    }
}
function writeCount(writer, flag1, flag2) {
    writer.writeUInt8(flag1); // Packet ID
    writer.writeUInt32(flag2 >>> 0); // Number of elements
}
// Team
updateMinimap.prototype.sendTeamPacket = function () {
    var writer = new BinaryWriter();
    writer.writeUInt8(0x21);    // Packet ID
    writer.writeUInt16(this.allClients.length >>> 0);            // EatRecordCount
    for (var i = 0; i < this.allClients.length; i++) {
        var node = this.allClients[i];
        var color = node.playerTracker.color;
        //TODO implement node position x, y and size;
        writer.writeUInt8(color.r >>> 0);       // Color R
        writer.writeUInt8(color.g >>> 0);       // Color G
        writer.writeUInt8(color.b >>> 0);       // Color B

        //write cell count
        var cells = node.playerTracker.cells;
        writer.writeUInt16(cells.length >>> 0);            // EatRecordCount
        for (var x = 0; x < cells.length; x++) {

            writer.writeUInt32(cells[x].position.x_ >> 0);                // Coordinate X
            writer.writeUInt32(cells[x].position.y >> 0);                // Coordinate Y
            writer.writeUInt16(cells[x]._size >>> 0);     // Cell Size (not to be confused with mass, because mass = size*size/100)

        }

        return writer.toBuffer();

    }



    //flag1 was originally 0x32, 16*3 + 2 = 50, i have no changed it to 51, a.k.a 0x32
    //output the clients length
    writeCount(writer, 0x33, this.leaderboard.length);
    for (var i = 0; i < this.leaderboard.length; i++) {
        var value = this.leaderboard[i];
        if (value == null) return null; // bad leaderboardm just don't send it
        if (isNaN(value)) value = 0;
        value = value < 0 ? 0 : value;
        value = value > 1 ? 1 : value;
        writer.writeFloat(value); // isMe flag (previously cell ID)
    }
    return writer.toBuffer();
};

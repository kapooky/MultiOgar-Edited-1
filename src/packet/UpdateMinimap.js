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

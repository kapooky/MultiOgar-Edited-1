var Packet = require('./packet');
var Vec2 = require('./modules/Vec2');
var playerCell = require('./entity/PlayerCell');
var BinaryWriter = require("./packet/BinaryWriter");

function PlayerTracker(gameServer, socket) {
    this.gameServer = gameServer;
    this.socket = socket;
    this.pID = -1;
    this.userAuth = null;
    this.isRemoved = false;
    this.isCloseRequested = false;
    this._name = "";
    this._skin = "";
    this._nameUtf8 = null;
    this._skinUtf8protocol11 = null;
    this._nameUnicode = null;
    this._skinUtf8 = null;
    this.color = { r: 0, g: 0, b: 0 };
    this.viewNodes = [];
    this.clientNodes = [];
    this.cells = [];
    this.mergeOverride = false; // Triggered by console command
    this._score = 0; // Needed for leaderboard
    this._scale = 1;
    this.borderCounter = 0;
    this.connectedTime = new Date();

    this.tickLeaderboard = 0;

    this.tickMinimap = 0;
    this.team = 0;
    this.spectate = false;
    this.freeRoam = false;      // Free-roam mode enables player to move in spectate mode
    this.spectateTarget = null; // Spectate target, null for largest player
    this.lastKeypressTick = 0;
    this.centerPos = new Vec2(0, 0);

    this.ismouseClicked = false;
    this.mouseClicked = new Vec2(0, 0);
    this.mouse = new Vec2(0, 0);
    this.viewBox = {
        minx: 0,
        miny: 0,
        maxx: 0,
        maxy: 0
    };

    // Scramble the coordinate system for anti-raga
    this.scrambleX = 0;
    this.scrambleY = 0;
    this.scrambleId = 0;
    this.isMinion = false;
    this.isd = false;

    // Custom commands
    this.spawnmass = 0;
    this.frozen = false;
    this.customspeed = 0;
    this.rec = false;

    // Minions
    this.miQ = 0;
    this.isMi = false;
    this.minionSplit = false;
    this.minionEject = false;
    this.minionFrozen = false;
    this.minionControl = false;
    this.collectPellets = false;

    // Gamemode function
    if (gameServer) {
        // Player id
        this.pID = gameServer.lastPlayerId++ >> 0;
        // Gamemode function
        gameServer.gameMode.onPlayerInit(this);
        // Only scramble if enabled in config
        this.scramble();
    }
    var UserRoleEnum = require("./enum/UserRoleEnum");
    this.userRole = UserRoleEnum.GUEST;
}

module.exports = PlayerTracker;

// Setters/Getters

PlayerTracker.prototype.scramble = function() {
    if (!this.gameServer.config.serverScrambleLevel) {
        this.scrambleId = 0;
        this.scrambleX = 0;
        this.scrambleY = 0;
    } else {
        this.scrambleId = (Math.random() * 0xFFFFFFFF) >>> 0;
        // avoid mouse packet limitations
        var maxx = Math.max(0, 31767 - this.gameServer.border.width);
        var maxy = Math.max(0, 31767 - this.gameServer.border.height);
        var x = maxx * Math.random();
        var y = maxy * Math.random();
        if (Math.random() >= 0.5) x = -x;
        if (Math.random() >= 0.5) y = -y;
        this.scrambleX = x;
        this.scrambleY = y;
    }
    this.borderCounter = 0;
};

PlayerTracker.prototype.setName = function(name) {
    this._name = name;
    var writer = new BinaryWriter()
    writer.writeStringZeroUnicode(name);
    this._nameUnicode = writer.toBuffer();
    writer = new BinaryWriter();
    writer.writeStringZeroUtf8(name);
    this._nameUtf8 = writer.toBuffer();
};

PlayerTracker.prototype.setSkin = function(skin) {
    this._skin = skin;
    var writer = new BinaryWriter();
    writer.writeStringZeroUtf8(skin);
    this._skinUtf8 = writer.toBuffer();
    var writer1 = new BinaryWriter();
    writer1.writeStringZeroUtf8("%" + skin);
    this._skinUtf8protocol11 = writer1.toBuffer();
};

PlayerTracker.prototype.getScale = function() {
    this._score = 0; // reset to not cause bugs with leaderboard
    var scale = 0; // reset to not cause bugs with viewbox
    for (var i = 0; i < this.cells.length; i++) {
        scale += this.cells[i]._size;
        this._score += this.cells[i]._mass;
    }
    if (!scale) return scale = this._score = 0.4; // reset scale
    else return this._scale = Math.pow(Math.min(64 / scale, 1), 0.4);
};

PlayerTracker.prototype.joinGame = function(name, skin) {
    if (this.cells.length) return;

    if (skin) this.setSkin(skin);
    if (!name) name = "An unnamed cell";
    this.setName(name);
    this.spectate = false;
    this.freeRoam = false;
    this.spectateTarget = null;
    var packetHandler = this.socket.packetHandler;

    if (!this.isMi && this.socket.isConnected != null) {
        // some old clients don't understand ClearAll message
        // so we will send update for them
        if (packetHandler.protocol < 6) {
            packetHandler.sendPacket(new Packet.UpdateNodes(this, [], [], [], this.clientNodes));
        }
        packetHandler.sendPacket(new Packet.ClearAll());
        this.clientNodes = [];
        this.scramble();
        if (this.gameServer.config.serverScrambleLevel < 2) {
            // no scramble / lightweight scramble
            packetHandler.sendPacket(new Packet.SetBorder(this, this.gameServer.border));
        }
        else if (this.gameServer.config.serverScrambleLevel == 3) {
            var ran = 10065536 * Math.random();
            // Ruins most known minimaps (no border)
            var border = {
                minx: this.gameServer.border.minx - ran,
                miny: this.gameServer.border.miny - ran,
                maxx: this.gameServer.border.maxx + ran,
                maxy: this.gameServer.border.maxy + ran
            };
            packetHandler.sendPacket(new Packet.SetBorder(this, border));
        }
    }
    this.gameServer.gameMode.onPlayerSpawn(this.gameServer, this);
};

PlayerTracker.prototype.checkConnection = function() {
    // Handle disconnection
    if (!this.socket.isConnected) {
        // Wait for playerDisconnectTime
        var pt = this.gameServer.config.playerDisconnectTime;
        var dt = (this.gameServer.stepDateTime - this.socket.closeTime) / 1e3;
        if (pt && (!this.cells.length || dt >= pt)) {
            // Remove all client cells
            while (this.cells.length) this.gameServer.removeNode(this.cells[0]);
        }
        this.cells = [];
        this.isRemoved = true;
        this.mouse = null;

        this.socket.packetHandler.pressSpace = false;
        this.socket.packetHandler.pressQ = false;
        this.socket.packetHandler.pressW = false;
        return;
    }

    // Check timeout
    if (!this.isCloseRequested && this.gameServer.config.serverTimeout) {
        dt = (this.gameServer.stepDateTime - this.socket.lastAliveTime) / 1000;
        if (dt >= this.gameServer.config.serverTimeout) {
            this.socket.close(1000, "Connection timeout");
            this.isCloseRequested = true;
        }
    }
};

PlayerTracker.prototype.updateTick = function() {
    if (this.isRemoved || this.isMinion)
        return; // do not update
    this.socket.packetHandler.process();
    if (this.isMi) return;

    // update viewbox
    this.updateSpecView(this.cells.length);
    var scale = Math.max(this.getScale(), this.gameServer.config.serverMinScale);
    var halfWidth = (this.gameServer.config.serverViewBaseX + 100) / scale / 2;
    var halfHeight = (this.gameServer.config.serverViewBaseY + 100) / scale / 2;
    this.viewBox = {
        minx: this.centerPos.x - halfWidth,
        miny: this.centerPos.y - halfHeight,
        maxx: this.centerPos.x + halfWidth,
        maxy: this.centerPos.y + halfHeight
    };

    // update visible nodes
    this.viewNodes = [];
    var self = this;
    this.gameServer.quadTree.find(this.viewBox, function(check) {
        self.viewNodes.push(check);
    });
    //what the fuck does this do
    this.viewNodes.sort(function(a, b) { return a.nodeId - b.nodeId; });
};

PlayerTracker.prototype.sendUpdate = function() {
    if (this.isRemoved || !this.socket.packetHandler.protocol ||
        !this.socket.isConnected || this.isMi || this.isMinion ||
        (this.socket._socket.writable != null && !this.socket._socket.writable) ||
        this.socket.readyState != this.socket.OPEN) {
        // do not send update for disconnected clients
        // also do not send if initialization is not complete yet
        return;
    }

    var packetHandler = this.socket.packetHandler;
    if (this.gameServer.config.serverScrambleLevel == 2) {
        // scramble (moving border)
        if (!this.borderCounter) {
            var b = this.gameServer.border, v = this.viewBox;
            var bound = {
                minx: Math.max(b.minx, v.minx - v.halfWidth),
                miny: Math.max(b.miny, v.miny - v.halfHeight),
                maxx: Math.min(b.maxx, v.maxx + v.halfWidth),
                maxy: Math.min(b.maxy, v.maxy + v.halfHeight)
            };
            packetHandler.sendPacket(new Packet.SetBorder(this, bound));
        }
        if (++this.borderCounter >= 20) this.borderCounter = 0;
    }
    var delNodes = [];
    var eatNodes = [];
    var addNodes = [];
    var updNodes = [];
    var oldIndex = 0;
    var newIndex = 0;
    for (; newIndex < this.viewNodes.length && oldIndex < this.clientNodes.length;) {
        if (this.viewNodes[newIndex].nodeId < this.clientNodes[oldIndex].nodeId) {
            if (this.viewNodes[newIndex].isRemoved) continue;
            addNodes.push(this.viewNodes[newIndex]);
            newIndex++;
            continue;
        }
        if (this.viewNodes[newIndex].nodeId > this.clientNodes[oldIndex].nodeId) {
            var node = this.clientNodes[oldIndex];
            if (node.isRemoved) eatNodes.push(node);
            else delNodes.push(node);
            oldIndex++;
            continue;
        }
        var node = this.viewNodes[newIndex];
        if (node.isRemoved) continue;
        // only send update for moving or player nodes
        if (node.isMoving || node.cellType == 0 || node.cellType == 2 || this.gameServer.config.serverGamemode == 3 && node.cellType == 1)
            updNodes.push(node);
        newIndex++;
        oldIndex++;
    }
    for (; newIndex < this.viewNodes.length; newIndex++) {
        addNodes.push(this.viewNodes[newIndex]);
    }
    for (; oldIndex < this.clientNodes.length; oldIndex++) {
        var node = this.clientNodes[oldIndex];
        if (node.isRemoved) eatNodes.push(node);
        else delNodes.push(node);
    }
    this.clientNodes = this.viewNodes;

    // Send update packet
    packetHandler.sendPacket(new Packet.UpdateNodes(this, addNodes, updNodes, eatNodes, delNodes));

    //updateMiniMap
    //This piece of code only works if the Gamemode is Teams.
    //fuck it, the minimap is now operating on it's own tickTime.
    if (this.gameServer.leaderboardType == 50) {
        // 1 / 0.040 = 25 (once per second)
        if (++this.tickMinimap > 25) {
            this.tickMinimap = 0;
            packetHandler.sendPacket(new Packet.UpdateMinimap(this, this.gameServer.leaderboard, this.gameServer.leaderboardType));
        }
    }

    /* Note, I could have injected minimap code into the nested if statement below, but then, I would lose the flexibility modifying the miniMap ticktime. I don't want the minimap and leaderboard to operate at the same ticktime. */

    // Update leaderboard
    if (++this.tickLeaderboard > 25) {
        // 1 / 0.040 = 25 (once per second)
        this.tickLeaderboard = 0;
        if (this.gameServer.leaderboardType >= 0)
            packetHandler.sendPacket(new Packet.UpdateLeaderboard(this, this.gameServer.leaderboard, this.gameServer.leaderboardType));
    }

};

PlayerTracker.prototype.circleBound = function (mousedata) {
    var dx, dy, node, LIST;
    if (this.freeRoam == true) {
        //we need to find the viewNodes, based on the free roam center position, once we have the nodes we can do some logic
        //toggling freeroam should not go here, consider the case where we dont end up finding a circle, then that would mean we would toggle out of freeroam. I don't want that functionality, I want to toggle out only if we find a circle.
        // this.freeRoam = false;
        var scale = this.gameServer.config.serverSpectatorScale;
        var halfWidth = (this.gameServer.config.serverViewBaseX + 100) / scale / 2;
        var halfHeight = (this.gameServer.config.serverViewBaseY + 100) / scale / 2;
        this.viewBox = {
            minx: this.centerPos.x - halfWidth,
            miny: this.centerPos.y - halfHeight,
            maxx: this.centerPos.x + halfWidth,
            maxy: this.centerPos.y + halfHeight
        };

        // update visible nodes
        this.viewNodes = [];
        var self = this;
        this.gameServer.quadTree.find(this.viewBox, function (check) {
            self.viewNodes.push(check);
        });

        LIST = this.viewNodes;


    } else {
        //Simple scenerio, this means we are spectating a player, and have clicked somewhere in the viewport. Return the viewNOdes of the player we are spectating. (line 277 already does this for us)
        LIST = this.viewNodes;

    }

    for (var i = 0; i < LIST.length; i++) {
        node = LIST[i];
        if (node instanceof playerCell) {
            //d = mousedata.clone().sub(node.position);
            dx = mousedata.x - node.position.x;
            dy = mousedata.y - node.position.y;

            // math to test if mouse is inside circle
            if (dx * dx + dy * dy < node._size * node._size) {
                return node;
            }
        }
    }
};
var lastd = new Vec2(0, 0);
PlayerTracker.prototype.updateSpecView = function(len) {
    var scale;
    if (!this.spectate || len) {
        // in game
        var cx = 0, cy = 0;
        for (var i = 0; i < len; i++) {
            //centerx is just the average x position of all the cells[i].position.x .... so is position.x on the quadrant?
            cx += this.cells[i].position.x / len;
            cy += this.cells[i].position.y / len;
            this.centerPos = new Vec2(cx, cy);
        }
    } else {
        //this.viewNodes will only be null at the very start, after that, it will always contain a reference to line 403's spectate target.
        if (this.ismouseClicked == true) { //yes im noob programmer, verbose code is best code
            var playerFound = this.circleBound(this.mouseClicked)
            if (playerFound != null) {
                //     //proper place to toggle free roam, if it's enabled;
                if (this.freeRoam) this.freeRoam = false;
                this.spectateTarget = playerFound.owner;
                //         //TODO also, initialize the scale variable to whatever the spectateTarget's scale is.
                //         //NOTE ^^ actually, never mind that comment just make sure to have this.spectateTarget = playerfound,and freeroam set to false. . This branch of this massive if statement only initailizes this.spectateTarget.
                //         // The next time this function is called,
                //         //it immediatley go to the last else branch (spectate target) branch of this if statement, and then dooes  all the relevant scaling.
                //
                //         //TODO fucking dammit, just realized, we must initialize scale in this part of the branch , otherwise we won't be able to send the camera packet, it requires scale as one of it's many paramaters.

                //NOTE this causes a bug
                //   this.setCenterPos(this.spectateTarget);

                scale = playerFound.owner.getScale();
            } else {
                if (this.freeRoam) {
                    var d = this.mouse.clone().sub(this.centerPos);
                    var difference = d.x - lastd.x;
                    scale = this.gameServer.config.serverSpectatorScale;
                    var fraction = d.sqDist();
                    var multiplier = 32 / fraction;
                    var temp = this.centerPos.add(d, multiplier);
                    this.setCenterPos(temp);
                    lastd = d;
                } else {
                    var player = this.getSpecTarget();
                    if (player) {
                        this.setCenterPos(player.centerPos);
                        scale = player.getScale();
                        this.place = player.place;
                        this.viewBox = player.viewBox;
                        //this.viewNodes = is basically all the nodes that the player sees ( player cell, virus, food, etc)
                        this.viewNodes = player.viewNodes;
                    }
                }
            }
            this.ismouseClicked = false;
        }
        //if (this.freeRoam || this.getSpecTarget() == null) {
        else if (this.freeRoam) {
            // free roam
            var d = this.mouse.clone().sub(this.centerPos);

            var difference = d.x - lastd.x;
            scale = this.gameServer.config.serverSpectatorScale;
            var fraction = d.sqDist();
            var multiplier = 32 / fraction;
            var temp = this.centerPos.add(d, multiplier);
            this.setCenterPos(temp);
            lastd = d;
        } else {
            // spectate target
            var player = this.getSpecTarget();
            if (player) {
                this.setCenterPos(player.centerPos);
                scale = player.getScale();
                this.place = player.place;
                this.viewBox = player.viewBox;
                //this.viewNodes = is basically all the nodes that the player sees ( player cell, virus, food, etc)
                this.viewNodes = player.viewNodes;
            }
        }
        // sends camera packet
        this.socket.packetHandler.sendPacket(new Packet.UpdatePosition(
            this, this.centerPos.x, this.centerPos.y, scale
        ));
    }
}

PlayerTracker.prototype.pressSpace = function() {
    if (this.spectate) {
        // Check for spam first (to prevent too many add/del updates)
        if (this.gameServer.tickCounter - this.lastKeypressTick < 40)
            return;
        this.lastKeypressTick = this.gameServer.tickCounter;

        // Space doesn't work for freeRoam mode
        if (this.freeRoam || this.gameServer.largestClient == null)
            return;
    } else if (this.gameServer.run) {
        // Disable mergeOverride on the last merging cell
        if (this.cells.length <= 2)
            this.mergeOverride = false;
        // Cant split if merging or frozen
        if (this.mergeOverride || this.frozen)
            return;
        this.gameServer.splitCells(this);
    }
};

PlayerTracker.prototype.pressW = function() {
    if (this.spectate || !this.gameServer.run) return;
    this.gameServer.ejectMass(this);
};

PlayerTracker.prototype.pressQ = function() {
    if (this.spectate) {
        // Check for spam first (to prevent too many add/del updates)
        if (this.gameServer.tickCounter - this.lastKeypressTick < 40)
            return;

        this.lastKeypressTick = this.gameServer.tickCounter;
        if (this.spectateTarget == null)
            this.freeRoam = !this.freeRoam;
        this.spectateTarget = null;
    }
};

PlayerTracker.prototype.getSpecTarget = function() {
    if (this.spectateTarget == null || this.spectateTarget.isRemoved) {
        this.spectateTarget = null;
        return this.gameServer.largestClient;
    }
    return this.spectateTarget;
};

PlayerTracker.prototype.setCenterPos = function (p) {
    //note what does this tell me? p is a point within the quadrant
    //this just ensures that the point is within the map boundaries.

    p.x = Math.max(p.x, this.gameServer.border.minx);
    p.y = Math.max(p.y, this.gameServer.border.miny);
    p.x = Math.min(p.x, this.gameServer.border.maxx);
    p.y = Math.min(p.y, this.gameServer.border.maxy);
    this.centerPos = p;
};

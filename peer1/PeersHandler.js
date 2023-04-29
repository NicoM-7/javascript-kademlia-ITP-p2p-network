//Get required modules
const net = require("net");
const fs = require("fs");
const kadPTPpacket = require("./kadPTPmessage");
const singleton = require("./Singleton");
const ITPresponse = require("./ITPResponse");
const kadPTP = require("./kadPTPpacket");

let myReceivingPort = null;

let peersList = [];

module.exports = {

  //Used to handle initial join
  handleClientJoining: function (sock, keyList, serverDHTtable) {
    handleClient(sock, keyList, serverDHTtable);
  },

  //Used to handle requests after join
  handleCommunications: function (clientSocket, clientName, keyList, clientDHTtable) {
    communicate(clientSocket, clientName, keyList, clientDHTtable)
  }
};

function handleClient(sock, keyList, serverDHTtable) {

  let kadPacket = null;
  let kadSearchPacket = null;
  let joiningPeerAddress = sock.remoteAddress + ":" + sock.remotePort;

  // initialize client DHT table
  let joiningPeerID = singleton.getPeerID(sock.remoteAddress, sock.remotePort)
  let joiningPeer = {
    peerName: "",
    peerIP: sock.remoteAddress,
    peerPort: sock.remotePort,
    peerID: joiningPeerID
  };

  // Triggered only when the client is sending kadPTP message
  sock.on('data', packet => {

    //If we got a kadPTP search packet enter, if not go to else
    if (parseInt(parseBitPacket(packet, 4, 8)) == 3) {

      //Set variables
      kadSearchPacket = packet;
      let fileName = bytes2string(packet.slice(16 + parseInt(parseBitPacket(packet, 20, 12))));
      let extensionNumber = parseInt(parseBitPacket(packet, 96 + (parseInt(parseBitPacket(packet, 20, 12) * 8)), 4));
      let fileType;

      //map extension numnber to file type
      if (extensionNumber == 1) {
        fileType = "bmp";
      }
      else if (extensionNumber == 2) {
        fileType = "jpeg";
      }
      else if (extensionNumber == 3) {
        fileType = "gif";
      }
      else if (extensionNumber == 4) {
        fileType = "png";
      }
      else if (extensionNumber == 5) {
        fileType = "tiff";
      }
      else if (extensionNumber == 15) {
        fileType = "raw";
      }

      //Check if this peer has the image in its keyList
      if (fileName + "." + fileType == keyList.imageName) {
        fs.readFile(fileName + "." + fileType, (err, data) => {     //Check if file is readable
          if (err) {
            //If its not readable thown an error and close the server connection
            sock.end();
          }
          else {  //If its readable, convert the image to an array of bytes and send a packet with correct headers and payload then close the connection
            const imageData = [...data];
            let socket = new net.Socket();
            let ip = "";
            for (let i = 0; i < 4; i++) {
              if (i == 3) {
                ip += parseBitPacket(packet, 32 + (parseInt(parseBitPacket(packet, 20, 12) * 8)) + (8 * i), 8);
              }
              else {
                ip += parseBitPacket(packet, 32 + (parseInt(parseBitPacket(packet, 20, 12) * 8)) + (8 * i), 8) + ".";
              }
            }
            let port = parseInt(parseBitPacket(packet, 64 + (8 * parseInt(parseBitPacket(packet, 20, 12))), 16));

            //Connect back to orignal image socket and send the image
            socket.connect(port, ip, () => {
              socket.write(ITPresponse.getPacket(4, singleton.getSequenceNumber(), singleton.getTimestamp(), imageData.length, imageData));
              socket.end();
              sock.end();
            });
          }
        });
      }

      else {

        //If this peer doesn't have it once again search its DHT, find the closest peer to its key ID and repeat

        let lowestDistance = "";
        let peer;

        //Create the largest binary number for logic
        for (let i = 0; i < 160; i++) {
          lowestDistance += "1";
        }

        //Loop over all peers to find peer closet to key
        for (let i = 0; i < serverDHTtable.table.length; i++) {
          let tempDistance = singleton.XORing(singleton.Hex2Bin(singleton.getKeyID(fileName + "." + fileType)), singleton.Hex2Bin(serverDHTtable.table[i].node.peerID));
          if (getSmallerBinaryString(tempDistance, lowestDistance) == tempDistance) {
            lowestDistance = tempDistance;
            peer = serverDHTtable.table[i];
          }
        }

        let kadSocket = new net.Socket();

        kadSocket.connect(peer.node.peerPort, peer.node.peerIP, () => {
          kadSocket.write(kadPTP.getPacket(7, 3, serverDHTtable.owner.peerName, kadSocket.address().address, parseInt(parseBitPacket(packet, 64 + (8 * parseInt(parseBitPacket(packet, 20, 12))), 16)), fileType, fileName));
          kadSocket.end();
        });
      }
    }
    else {
      kadPacket = parseMessage(packet);
    }
  });

  sock.on('end', () => {
    // client edded the connection
    if (kadPacket) {
      // Here, the msgType cannot be 1. It can be 2 or greater
      if (kadPacket.msgType == 2) {
        console.log("Received Hello Message from " + kadPacket.senderName);

        if (kadPacket.peersList.length > 0) {
          let output = "  along with DHT: ";
          // now we can assign the peer name
          joiningPeer.peerName = kadPacket.senderName;
          for (var i = 0; i < kadPacket.peersList.length; i++) {
            output +=
              "[" +
              kadPacket.peersList[i].peerIP + ":" +
              kadPacket.peersList[i].peerPort + ", " +
              kadPacket.peersList[i].peerID +
              "]\n                  ";
          }
          console.log(output);
        }

        // add the sender into the table only if it is not exist or set the name of the exisiting one
        let exist = serverDHTtable.table.find(e => e.node.peerPort == joiningPeer.peerPort);
        if (exist) {
          exist.node.peerName = joiningPeer.peerName;
        } else {
          pushBucket(serverDHTtable, joiningPeer);
        }

        // Now update the DHT table
        updateDHTtable(serverDHTtable, kadPacket.peersList);
      }
    }

    else {
      if (!kadSearchPacket) {
        // This was a bootstrap request
        console.log("Connected from peer " + joiningPeerAddress + "\n");
        // add the requester info into server DHT table
        pushBucket(serverDHTtable, joiningPeer);
      }
    }
  });

  setTimeout(() => {
    if (kadPacket == null && kadSearchPacket == null) {
      kadPTPpacket.init(7, 1, serverDHTtable);
      sock.write(kadPTPpacket.getPacket());
      sock.end();
    }
  }, 2000);
}

function communicate(clientSocket, clientName, keyList, clientDHTtable) {
  let senderPeerID = singleton.getPeerID(clientSocket.remoteAddress, clientSocket.remotePort)

  clientSocket.on('data', (message) => {
    let kadPacket = parseMessage(message);

    let senderPeerName = kadPacket.senderName;
    let senderPeer = {
      peerName: senderPeerName,
      peerIP: clientSocket.remoteAddress,
      peerPort: clientSocket.remotePort,
      peerID: senderPeerID
    };

    if (kadPacket.msgType == 1) {
      // This message comes from the server
      console.log(
        "Connected to " +
        senderPeerName +
        ":" +
        clientSocket.remotePort +
        " at timestamp: " +
        singleton.getTimestamp() + "\n"
      );

      // Now run as a server
      myReceivingPort = clientSocket.localPort;
      let localPeerID = singleton.getPeerID(clientSocket.localAddress, myReceivingPort);
      let serverPeer = net.createServer();
      serverPeer.listen(myReceivingPort, clientSocket.localAddress);
      console.log(
        "This peer address is " +
        clientSocket.localAddress +
        ":" +
        myReceivingPort +
        " located at " +
        clientName +
        " [" + localPeerID + "]\n"
      );

      // Wait for other peers to connect
      serverPeer.on("connection", function (sock) {
        handleClient(sock, keyList, clientDHTtable);
      });

      console.log("Received Welcome message from " + senderPeerName) + "\n";
      if (kadPacket.peersList.length > 0) {
        let output = "  along with DHT: ";
        for (var i = 0; i < kadPacket.peersList.length; i++) {
          output +=
            "[" +
            kadPacket.peersList[i].peerIP + ":" +
            kadPacket.peersList[i].peerPort + ", " +
            kadPacket.peersList[i].peerID +
            "]\n                  ";
        }
        console.log(output);
      } else {
        console.log("  along with DHT: []\n");
      }

      // add the bootstrap node into the DHT table but only if it is not exist already
      let exist = clientDHTtable.table.find(e => e.node.peerPort == clientSocket.remotePort);
      if (!exist) {
        pushBucket(clientDHTtable, senderPeer);
      } else {
        console.log(senderPeer.peerPort + " is exist already")
      }

      updateDHTtable(clientDHTtable, kadPacket.peersList)

    } else {
      // Later we will consider other message types.
      console.log("The message type " + kadPacket.msgType + " is not supported")
    }
  });

  clientSocket.on("end", () => {
    // disconnected from server
    sendHello(clientDHTtable)
  })
}

function updateDHTtable(DHTtable, list) {
  // Refresh the local k-buckets using the transmitted list of peers. 

  refreshBucket(DHTtable, list)
  console.log("Refresh k-Bucket operation is performed.\n");

  if (DHTtable.table.length > 0) {
    let output = "My DHT: ";
    for (var i = 0; i < DHTtable.table.length; i++) {
      output +=
        "[" +
        DHTtable.table[i].node.peerIP + ":" +
        DHTtable.table[i].node.peerPort + ", " +
        DHTtable.table[i].node.peerID +
        "]\n        ";
    }
    console.log(output);
  }

}

function parseMessage(message) {
  let kadPacket = {}
  peersList = [];
  let bitMarker = 0;
  kadPacket.version = parseBitPacket(message, 0, 4);
  bitMarker += 4;
  kadPacket.msgType = parseBitPacket(message, 4, 8);
  bitMarker += 8;
  let numberOfPeers = parseBitPacket(message, 12, 8);
  bitMarker += 8;
  let SenderNameSize = parseBitPacket(message, 20, 12);
  bitMarker += 12;
  kadPacket.senderName = bytes2string(message.slice(4, SenderNameSize + 4));
  bitMarker += SenderNameSize * 8;

  if (numberOfPeers > 0) {
    for (var i = 0; i < numberOfPeers; i++) {
      let firstOctet = parseBitPacket(message, bitMarker, 8);
      bitMarker += 8;
      let secondOctet = parseBitPacket(message, bitMarker, 8);
      bitMarker += 8;
      let thirdOctet = parseBitPacket(message, bitMarker, 8);
      bitMarker += 8;
      let forthOctet = parseBitPacket(message, bitMarker, 8);
      bitMarker += 8;
      let port = parseBitPacket(message, bitMarker, 16);
      bitMarker += 16;
      let IP = firstOctet + "." + secondOctet + "." + thirdOctet + "." + forthOctet;
      let peerID = singleton.getPeerID(IP, port);
      let aPeer = {
        peerIP: IP,
        peerPort: port,
        peerID: peerID
      };
      peersList.push(aPeer);
    }
  }
  kadPacket.peersList = peersList;
  return kadPacket;
}

function refreshBucket(T, peersList) {
  peersList.forEach(P => {
    pushBucket(T, P);
  });
}

// pushBucket method stores the peer’s information (IP address, port number, and peer ID) 
// into the appropriate k-bucket of the DHTtable. 
function pushBucket(T, P) {
  // First make sure that the given peer is not the loacl peer itself, then  
  // determine the prefix i which is the maximum number of the leftmost bits shared between  
  // peerID the owner of the DHTtable and the given peer ID. 

  if (T.owner.peerID != P.peerID) {
    let localID = singleton.Hex2Bin(T.owner.peerID);
    let receiverID = singleton.Hex2Bin(P.peerID);
    // Count how many bits match
    let i = 0;
    for (i = 0; i < localID.length; i++) {
      if (localID[i] != receiverID[i])
        break;
    }

    let k_bucket = {
      prefix: i,
      node: P
    };

    let exist = T.table.find(e => e.prefix === i);
    if (exist) {
      // insert the closest 
      if (singleton.XORing(localID, singleton.Hex2Bin(k_bucket.node.peerID)) <
        singleton.XORing(localID, singleton.Hex2Bin(exist.node.peerID))) {
        // remove the existing one
        for (var k = 0; k < T.table.length; k++) {
          if (T.table[k].node.peerID == exist.node.peerID) {
            console.log("** The peer " + exist.node.peerID + " is removed and\n** The peer " +
              k_bucket.node.peerID + " is added instead")
            T.table.splice(k, 1);
            break;
          }
        }
        // add the new one    
        T.table.push(k_bucket);
      }
    } else {
      T.table.push(k_bucket);
    }
  }

}
// The method scans the k-buckets of T and send hello message packet to every peer P in T, one at a time. 
function sendHello(T) {
  let i = 0;
  // we use echoPeer method to do recursive method calls
  echoPeer(T, i);
}

// This method call itself (T.table.length) number of times,
// each time it sends hello messags to all peers in T
function echoPeer(T, i) {
  setTimeout(() => {
    let sock = new net.Socket();
    sock.connect(
      {
        port: T.table[i].node.peerPort,
        host: T.table[i].node.peerIP,
        localPort: T.owner.peerPort
      },
      () => {
        // send Hello packet 
        kadPTPpacket.init(7, 2, T);
        sock.write(kadPTPpacket.getPacket());
        setTimeout(() => {
          sock.end();
          sock.destroy();
        }, 500)
      }
    );
    sock.on('close', () => {
      i++;
      if (i < T.table.length) {
        echoPeer(T, i)
      }
    })
    if (i == T.table.length - 1) {
      console.log("Hello packet has been sent.\n");
    }
  }, 500)
}

function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    if (array[i] > 0) result += String.fromCharCode(array[i]);
  }
  return result;
}

// return integer value of a subset bits
function parseBitPacket(packet, offset, length) {
  let number = "";
  for (var i = 0; i < length; i++) {
    // let us get the actual byte position of the offset
    let bytePosition = Math.floor((offset + i) / 8);
    let bitPosition = 7 - ((offset + i) % 8);
    let bit = (packet[bytePosition] >> bitPosition) % 2;
    number = (number << 1) | bit;
  }
  return number;
}

function getSmallerBinaryString(str1, str2) {
  // Pad the binary strings with zeros to the same length
  while (str1.length < str2.length) {
    str1 = '0' + str1;
  }
  while (str2.length < str1.length) {
    str2 = '0' + str2;
  }

  // Compare each bit in the strings
  for (let i = 0; i < str1.length; i++) {
    if (str1[i] !== str2[i]) {
      return (str1[i] === '0') ? str1 : str2; // Return the smaller string
    }
  }

  // If the strings are identical, return either one
  return str1;
}

// Prints the entire packet in bits format
function printPacketBit(packet) {
  var bitString = "";

  for (var i = 0; i < packet.length; i++) {
    // To add leading zeros
    var b = "00000000" + packet[i].toString(2);
    // To print 4 bytes per line
    if (i > 0 && i % 4 == 0) bitString += "\n";
    bitString += " " + b.substr(b.length - 8);
  }
  console.log(bitString);
}
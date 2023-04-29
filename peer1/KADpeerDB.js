//Get required modules
const net = require("net");
const singleton = require("./Singleton");
const handler = require("./PeersHandler");
const os = require("os");
const fs = require("fs");
const ITPresponse = require("./ITPResponse");
const kadPTPpacket = require("./kadPTPpacket");

singleton.init(); //Initialize singleton

let myName = __dirname.split("\\")[__dirname.split("\\").length - 1];   //Get name of directory where JS file is running

let ifaces = os.networkInterfaces();
let HOST = "";

let peerPort;
let fileName;
let imagePort = singleton.getPort(); //get random port number
let firstTime = false;
let recieverSocket;

//Depending on the name of the directory assign the image name that the peer should have and the port it should run on
switch (parseInt(myName.split("")[myName.split("").length - 1])) {
  case 1:
    peerPort = 2001;
    fileName = "Canna.gif";
    break;
  case 2:
    peerPort = 2055;
    fileName = "Flicker.jpeg";
    break;
  case 3:
    peerPort = 2077;
    fileName = "CherryBlossom.gif";
    break;
  case 4:
    peerPort = 2044;
    fileName = "Parrot.jpeg";
    break;
  case 5:
    peerPort = 2005;
    fileName = "Cardinal.jpeg";
    break;
  default:
    break;
}

// get the loaclhost ip address
Object.keys(ifaces).forEach(function (ifname) {
  ifaces[ifname].forEach(function (iface) {
    if ("IPv4" == iface.family && iface.internal !== false) {
      HOST = iface.address;
    }
  });
});

//Assign peer id and image key 
let peerID = singleton.getPeerID(HOST, peerPort);
let keyList = { keyID: singleton.getKeyID(fileName), imageName: fileName };

//If run with p option enter if, if not go in else
if (process.argv.length > 2) {

  //Get host and port that peer wants to connect to
  let knownHOST = process.argv[3].split(":")[0];
  let knownPORT = process.argv[3].split(":")[1];

  //Create a socket that will be used to connect to peer
  let clientSocket = new net.Socket();

  //Connect to server using ip and port above
  clientSocket.connect({ port: knownPORT, host: knownHOST, localPort: peerPort }, () => {

    // initialize client DHT table
    let clientID = singleton.getPeerID(clientSocket.localAddress, peerPort);
    let clientPeer = {
      peerName: myName,
      peerIP: clientSocket.localAddress,
      peerPort: peerPort,
      peerID: clientID
    };

    let clientDHTtable = {
      owner: clientPeer,
      table: []
    }

    handler.handleCommunications(clientSocket, myName, keyList, clientDHTtable);
  });

} else {
  // call as node peer (no arguments)
  // run as a server

  //Create a peer and image server 
  let peerSocket = net.createServer();
  let imageSocket = net.createServer();

  //Assign servers to correct host and port
  peerSocket.listen(peerPort, HOST);
  imageSocket.listen(imagePort, HOST);

  console.log("ImageDB server is started at timestamp: " + singleton.getTimestamp() + " and is listening on " + HOST + ":" + imagePort + "\n");
  console.log("This peer address is " + HOST + ":" + peerPort + " located at " + myName + " [" + peerID + "]");

  // initialize server DHT table
  let serverPeer = {
    peerName: myName,
    peerIP: HOST,
    peerPort: peerPort,
    peerID: peerID
  };

  let serverDHTtable = {
    owner: serverPeer,
    table: []
  }

  //Call whenever someone connects to peerSocket
  peerSocket.on("connection", function (sock) {
    handler.handleClientJoining(sock, keyList, serverDHTtable);
  });

  //Call whenever someone connects to imageSocket
  imageSocket.on("connection", function (sock) {

    //The first connection will always be the reciever that wants the image, we need a way to remember this socket in case the orignal peer doesn't have the image
    if (!firstTime) {
      firstTime = true;
      recieverSocket = sock;
    }

    //entered whenever image socket recieves data
    sock.on("data", packet => {

      //If another peer found the image, enter if block, if not go to else
      if (parseInt(parseBitPacket(packet, 4, 8)) == 4) {
        recieverSocket.write(ITPresponse.getPacket(1, singleton.getSequenceNumber(), singleton.getTimestamp(), parseInt(parseBitPacket(packet, 64, 32)), packet.slice(12)));
      }
      else {

        //Get image data from packet
        let fileName = bytes2string(packet.slice(12));
        let extensionNumber = parseInt(parseBitPacket(packet, 64, 4));
        let fileType;

        //Map extension number to correct fileType
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

        //Check if this peer has image in its keyList
        if (fileName + "." + fileType === keyList.imageName) {
          //If this peer has the image send it
          fs.readFile(fileName + "." + fileType, (err, data) => {     //Check if file is readable
            if (err) {
              //If its not readable (DNE) close the server connection
              sock.end();
            }
            else {  //If its readable, convert the image to an array of bytes and send a packet with correct headers and payload then close the connection
              const imageData = [...data];
              sock.write(ITPresponse.getPacket(1, singleton.getSequenceNumber(), singleton.getTimestamp(), imageData.length, imageData));
              sock.end();
            }
          });
        }

        else {

          //If this peer doesn't have the image we are looking for, check the closet peer in its DHT table

          let lowestDistance = "";
          let peer;

          //Used for checking condition, to get the lowest number in a list, in our condition we need to start the with the highestNumber, in this case an ID is 160 bits, so 160 bits of 1 is the largest
          for (let i = 0; i < 160; i++) {
            lowestDistance += "1";
          }

          //Loop over all peer ids and perform XOR with key id, whichever XOR returns the smallest binary number is the closet
          for (let i = 0; i < serverDHTtable.table.length; i++) {
            let tempDistance = singleton.XORing(singleton.Hex2Bin(singleton.getKeyID(fileName + "." + fileType)), singleton.Hex2Bin(serverDHTtable.table[i].node.peerID));
            if (getSmallerBinaryString(tempDistance, lowestDistance) == tempDistance) {
              lowestDistance = tempDistance;
              peer = serverDHTtable.table[i];
            }
          }

          let socket = new net.Socket();

          //Connect to the closet peer that we found with kadPTP packet
          socket.connect(peer.node.peerPort, peer.node.peerIP, () => {
            socket.write(kadPTPpacket.getPacket(7, 3, serverDHTtable.owner.peerName, socket.address().address, imagePort, extensionNumber, fileName));
            socket.end();
          });
        }
      }
    });
  });
}

// Returns the integer value of the extracted bits fragment for a given packet
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

function bytes2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    if (array[i] > 0) result += String.fromCharCode(array[i]);
  }
  return result;
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
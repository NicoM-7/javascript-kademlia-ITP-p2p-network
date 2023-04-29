module.exports = {
    //Initializes a packet using the following parameters as fields
    init: function (version, messageType, senderName, ip, imagePort, fileType, fileName) {

        //Creates a byte array of size depending on the sender name length and file name length
        const packet = new Uint8Array(16 + senderName.length + fileName.length);

        //Set bits in packet for specific values
        storeBitPacket(packet, version, 0, 4);
        storeBitPacket(packet, messageType, 4, 8);
        storeBitPacket(packet, senderName.length, 20, 12);

        //Set the bytes for each character in the sender name
        for (let i = 0; i < senderName.length; i++) {
            storeBitPacket(packet, stringToBytes(senderName)[i], 32 + (8 * i), 8);
        }

        //Set the bytes for the IP
        for (let i = 0; i < 4; i++) {
            storeBitPacket(packet, parseInt(ip.split(".")[i]), 32 + (senderName.length * 8) + (8 * i), 8);
        }

        //Set bits in packet for specific values
        storeBitPacket(packet, parseInt(imagePort), 64 + (senderName.length * 8), 16);
        storeBitPacket(packet, parseInt(fileType), 96 + (senderName.length * 8), 4);
        storeBitPacket(packet, parseInt(fileName.length), 100 + (senderName.length * 8), 28);

        //Set the bytes for the file name
        for (let i = 0; i < fileName.length; i++) {
            storeBitPacket(packet, stringToBytes(fileName)[i], 128 + (senderName.length * 8) + (8 * i), 8)
        }

        return packet;
    },

    //Call init to build packet
    getPacket: function (version, messageType, senderName, ip, imagePort, fileType, fileName) {
        return this.init(version, messageType, senderName, ip, imagePort, fileType, fileName);
    }
};

function stringToBytes(str) {
    var ch,
        st,
        re = [];
    for (var i = 0; i < str.length; i++) {
        ch = str.charCodeAt(i); // get char
        st = []; // set up "stack"
        do {
            st.push(ch & 0xff); // push byte to stack
            ch = ch >>> 8; // shift value down by 1 byte
        } while (ch);
        // add stack contents to result
        // done because chars have "wrong" endianness
        re = re.concat(st.reverse());
    }
    // return an array of bytes
    return re;
}

// Store integer value into the packet bit stream
function storeBitPacket(packet, value, offset, length) {
    // let us get the actual byte position of the offset
    let lastBitPosition = offset + length - 1;
    let number = value.toString(2);
    let j = number.length - 1;
    for (var i = 0; i < number.length; i++) {
        let bytePosition = Math.floor(lastBitPosition / 8);
        let bitPosition = 7 - (lastBitPosition % 8);
        if (number.charAt(j--) == "0") {
            packet[bytePosition] &= ~(1 << bitPosition);
        } else {
            packet[bytePosition] |= 1 << bitPosition;
        }
        lastBitPosition--;
    }
}
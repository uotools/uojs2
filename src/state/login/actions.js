import { Packet } from '../../network/packet';
import { StringUtils } from '../../utils';
import * as types from './actionTypes';
import { EmulationVersion } from '../../constants';

export const receiveServerlist = (socket, packet) => (dispatch) => {
    const servers = new Array(packet.getShort(4)).fill({});
    const serverList = servers.map((o, index) => {
        // each entry is 40b at offset=6
        const offset = index * 40 + 6;
        const id = packet.getShort(offset);
        const name = packet.getString(offset + 2, 32);
        const address = [
            // it uses network endian, so the IP address is "reversed"
            packet.getByte(offset + 39),
            packet.getByte(offset + 38),
            packet.getByte(offset + 37),
            packet.getByte(offset + 36)
        ];
        return {
            id,
            name,
            address: address.join('.')
        };
    });

    dispatch({
        type: types.LOGIN_SERVERLIST,
        payload: serverList
    });
};

export const receiveServerRelay /* aka login success!*/ = (socket, packet) => (dispatch) => {
    /*
        this packet sends the client the [new] address to (re)connect to.
        generally, it's the same address of the login server, but in a couple
        of cases, they can be different.

        HOWEVER! currently, since we're using websockify, we can only reconnect
        onto the same server at this time. I think there's a way to setup tokens
        through websockify to change this, but I haven't had the time to look
        into that...

        so instead of connecting to the given server, we're gonna reconnect
        to the same server :/

        also, weirdly enough, this does NOT use big endian for the address.
     */
    const address = [
        packet.getByte(1),
        packet.getByte(2),
        packet.getByte(3),
        packet.getByte(4)
    ].join('.');

    const port = packet.getShort(5);
    const key = [
        packet.getByte(7),
        packet.getByte(8),
        packet.getByte(9),
        packet.getByte(10)
    ];

    console.warn(`received a server relay, but I can't connect to ${address}:${port} because I'm not able to yet...`);
    console.warn(`we'll just connect to the same address/port again`);

    dispatch({
        type: types.LOGIN_SERVER_RELAY,
        payload: key
    });
};

export const receiveLoginFailure = (socket, packet) => (dispatch) => {
    /*
        depending on the server used (particularly runuo/servuo), this packet
        might not even exist. there is a bug in these servers that causes the packet
        to not get written to the stream. the socket closes (on their end) before
        its flushed.
     */
    const reason = {
        0: 'Incorrect name/password',
        1: 'Someone is already using this account',
        2: 'Your account is blocked',
        3: 'Your account credentials are invalid',
        4: 'Communication problem',
        5: 'IGR concurrency limit met',
        6: 'IGR time limit met',
        7: 'General IGR failure'
    }[packet.getByte(1)] || 'Unknown login issue';

    dispatch({
        type: types.LOGIN_FAILURE,
        payload: reason
    });
};

export const receiveCharacterList = (socket, packet) => (dispatch) => {
    console.log('character list');

    const characterCount = packet.getByte(3);
    const characters = [];
    console.log(`there are ${characterCount} character slots to loop over`);

    if (characterCount < 5 || characterCount > 7) {
        throw 'character count in 0xA9 is not valid. it should be in (5, 6, 7)';
    }

    let position = 4;
    for(let i = 0; i < characterCount; i++) {
        characters.push({
            name: packet.getString(4 + i * 60, 30),
            password: packet.getString(34 + i * 60, 30) // wut?
        });

        position += 60;
    }

    dispatch({
        type: types.LOGIN_RECV_CHAR_LIST,
        payload: characters
    });
};

export const receiveFeatures = (socket, packet) => (dispatch) => {
    const flags = packet.getInt(1);

    dispatch({
        type: types.LOGIN_RECV_FEATURES,
        payload: flags
    });
};

export const chooseShard = (socket, shardId = 0) => (dispatch) => {
    const packet = new Packet(3);
    // shard.id is technically a short, but I'm saying it's a byte
    // and padding the first with a zero.
    packet.append(0xA0, 0, shardId);
    socket.send(packet);

    dispatch({
        type: types.LOGIN_SELECT_SHARD,
        payload: shardId
    });
};

export const chooseCharacter = (socket, characterIndex = 0) => (dispatch, getState) => {
    const state = getState();
    const characters = state.login.user.characters;
    //console.log('state', state, characters,);
    //console.log('chosen character', chosenCharacter);
    const chosenCharacter = characters[characterIndex];
    const packet = new Packet([
        0x5d, 0xed, 0xed, 0xed, 0xed, 0x4b, 0x65, 0x76,
0x69, 0x6e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x3f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0xa8, 0x01,
0x8b
    ]);
    /*
    const packet = new Packet(73);
    console.info('choosing character', chosenCharacter);
    packet.append(0x5D, 0xED, 0xED, 0xED, 0xED);
    //        login.append(0x5D, 0xED, 0xED, 0xED, 0xED, chars[UO.login.slot].pad(30, '\0', 1),

    packet.append(StringUtils.padRight(chosenCharacter.name, 30));
    packet.append(Array(5), 0x1F, Array(7), 0x16, Array(19));
    packet.append(characterIndex);
    packet.append(0xc0, 0xa8, 0x01, 0x8b);
*/
    socket.send(packet);

    dispatch({
        type: types.LOGIN_CHOOSE_CHAR,
        payload: characterIndex
    });
};

export const sendVersionString = (socket) => (dispatch) => {
    //const length = 4 + EmulationVersion.length;
    //const versionPacket = new Packet(length);
    //versionPacket.append(0xBD, 0x00, length, EmulationVersion, 0);
    const v = [0xbd, 0x00, 0x0d, 0x37, 0x2e, 0x30, 0x2e, 0x34,
0x39, 0x2e, 0x36, 0x39, 0x00];

    socket.send(new Packet(v));

    dispatch({
        type: types.LOGIN_SENT_VERSION,
        payload: EmulationVersion
    });
};

const AWS = require('aws-sdk');
const Deck = require('./Deck');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;
const apiGatewayManagementApi = new AWS.ApiGatewayManagementApi({
    endpoint: process.env.WEBSOCKET_ENDPOINT // Set this environment variable to your WebSocket API endpoint.
});

function setBlindsAndDeal(gameState) {
    const smallBlindAmount = gameState.initialBigBlind / 2;
    const bigBlindAmount = gameState.initialBigBlind;
    const bigBlindIndex = (gameState.smallBlindIndex + 1) % gameState.players.length;

    const deck = new Deck();
    deck.shuffle();

    const updatedPlayers = gameState.players.map((player, index) => {
        const isSmallBlind = index === gameState.smallBlindIndex;
        const isBigBlind = index === bigBlindIndex;
        const betAmount = isSmallBlind ? smallBlindAmount : (isBigBlind ? bigBlindAmount : 0);
        const chips = player.chips - betAmount;
        const potContribution = player.potContribution + betAmount;
        
        return {
            ...player,
            bet: betAmount,
            chips,
            potContribution,
            hand: deck.deal(2),
        };
    });

    const newPot = gameState.pot + smallBlindAmount + bigBlindAmount;
    const nextTurn = (bigBlindIndex + 1) % gameState.players.length;
    const newGameState = {
        ...gameState,
        players: updatedPlayers,
        pot: newPot,
        deck: deck,
        gameStage: 'preFlop',
        highestBet: 10,
        bettingStarted: true,
        currentTurn: nextTurn,
    };

    return newGameState;
}

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const { gameId, playerId } = JSON.parse(event.body);

    try {
        const gameSessionResponse = await dynamoDb.get({
            TableName: tableName,
            Key: { gameId },
        }).promise();

        let gameSession = gameSessionResponse.Item;

        if (!gameSession) {
            return { statusCode: 404, body: JSON.stringify({ message: "Game session not found." }) };
        }

        if (gameSession.gameInProgress) {
            return { statusCode: 403, body: JSON.stringify({ message: "Game is already in progress. You can only spectate." }) };
        }

        if (gameSession.players.length >= gameSession.maxPlayers) {
            return { statusCode: 400, body: JSON.stringify({ message: "Maximum number of players reached." }) };
        }

        const newPlayer = {
            id: playerId,
            position: gameSession.players.length,
            chips: gameSession.buyIn,
            bet: 0,
            inHand: true,
            isReady: false,
            hand: [],
            hasActed: false,
            potContribution: 0,
            isAllIn: false,
            amountWon: 0,
            handDescription: null,
            bestHand: null,
        };

        gameSession.players.push(newPlayer);
        gameSession.playerCount = gameSession.players.length;

        let message = "Player added successfully.";
        let updateExpression = 'SET players = :players, playerCount = :playerCount';
        let expressionAttributeValues = {
            ':players': gameSession.players,
            ':playerCount': gameSession.playerCount,
        };

        if (gameSession.players.length >= gameSession.minPlayers) {
            gameSession = setBlindsAndDeal(gameSession);
            gameSession.gameStarted = true;
            gameSession.gameInProgress = true;
            message += " Minimum number of players reached. Game started!";
            updateExpression = 'SET players = :players, playerCount = :playerCount, gameStarted = :gameStarted, pot = :pot, currentTurn = :currentTurn, gameStage = :gameStage, gameInProgress = :gameInProgress, deck = :deck, highestBet = :highestBet, bettingStarted = :bettingStarted';
            expressionAttributeValues[':gameStarted'] = gameSession.gameStarted;
            expressionAttributeValues[':pot'] = gameSession.pot;
            expressionAttributeValues[':currentTurn'] = gameSession.currentTurn;
            expressionAttributeValues[':gameStage'] = gameSession.gameStage;
            expressionAttributeValues[':players'] = gameSession.players;
            expressionAttributeValues[':gameInProgress'] = gameSession.gameInProgress;
            expressionAttributeValues[':deck'] = gameSession.deck;
            expressionAttributeValues[':highestBet'] = gameSession.highestBet;
            expressionAttributeValues[':bettingStarted'] = gameSession.bettingStarted;
        }

        await dynamoDb.update({
            TableName: tableName,
            Key: { gameId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW',
        }).promise();

        await apiGatewayManagementApi.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify({
                message: 'Player joined successfully',
                gameDetails: gameSession
            })
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({ message }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to join game" }),
        };
    }
};
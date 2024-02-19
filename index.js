const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.GAME_TABLE;

exports.handler = async (event) => {
  const { gameId, playerUsername } = JSON.parse(event.body);

  // Retrieve the game session by gameId
  try {
    const gameSessionResponse = await dynamoDb.get({
      TableName: tableName,
      Key: { gameId },
    }).promise();

    const gameSession = gameSessionResponse.Item;

    // Check if the game session exists
    if (!gameSession) {
      return { statusCode: 404, body: JSON.stringify({ message: "Game session not found." }) };
    }

    // Check if the maximum number of players has been reached
    if (gameSession.players.length >= gameSession.maxPlayers) {
      return { statusCode: 400, body: JSON.stringify({ message: "Maximum number of players reached." }) };
    }

    // Add player to game session
    gameSession.players.push(playerUsername);

    // Update the game session in DynamoDB
    await dynamoDb.update({
      TableName: tableName,
      Key: { gameId },
      UpdateExpression: 'SET players = :players',
      ExpressionAttributeValues: {
        ':players': gameSession.players,
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    // Check if the minimum number of players has been met and potentially initialize the game
    let message = "Player added successfully.";
    if (gameSession.players.length >= gameSession.minPlayers) {
      // Initialize game logic here (to be implemented)
      // TODO: IMPLEMENT THE INITIALISE GAME
      message += " Minimum number of players reached. Initializing game...";
    }

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

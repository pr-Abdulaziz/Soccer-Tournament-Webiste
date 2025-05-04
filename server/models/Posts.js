module.exports = (sequelize, DataTypes) => {
  const Posts = sequelize.define(
    'Posts',                       // ← model name
    {
      title:  { type: DataTypes.STRING, allowNull: false },
      body:   { type: DataTypes.TEXT,   allowNull: false }
    },
    { tableName: 'posts', timestamps: false }
  );

  // Posts.associate = models => { … };

  return Posts;                    // ← MUST return the model
};
import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { useColors, useTheme } from '../services/theme';

import HomeScreen from '../screens/HomeScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import ActivityScreen from '../screens/ActivityScreen';
import ActivityDetailScreen from '../screens/ActivityDetailScreen';
import ExecuteScreen from '../screens/ExecuteScreen';
import LiveOutputScreen from '../screens/LiveOutputScreen';
import RunHistoryScreen from '../screens/RunHistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const ChatStack = createNativeStackNavigator();
const ExecuteStack = createNativeStackNavigator();
const ActivityStack = createNativeStackNavigator();

function useStackScreenOptions() {
  const c = useColors();
  return { headerStyle: { backgroundColor: c.bgElevated }, headerTintColor: c.text, headerShadowVisible: false } as const;
}

function ChatNavigator() {
  const opts = useStackScreenOptions();
  return (
    <ChatStack.Navigator screenOptions={opts}>
      <ChatStack.Screen name="ChatList" component={ChatListScreen} options={{ title: 'Chat' }} />
      <ChatStack.Screen name="ChatConversation" component={ChatScreen} options={{ title: 'Conversation' }} />
    </ChatStack.Navigator>
  );
}

function ExecuteNavigator() {
  const opts = useStackScreenOptions();
  return (
    <ExecuteStack.Navigator screenOptions={opts}>
      <ExecuteStack.Screen name="ExecuteMain" component={ExecuteScreen} options={{ title: 'Execute' }} />
      <ExecuteStack.Screen name="LiveOutput" component={LiveOutputScreen} options={{ title: 'Run' }} />
      <ExecuteStack.Screen name="RunHistory" component={RunHistoryScreen} options={{ title: 'Recent Runs' }} />
      <ExecuteStack.Screen name="RunDetail" component={ActivityDetailScreen} options={{ title: 'Run' }} />
    </ExecuteStack.Navigator>
  );
}

function ActivityNavigator() {
  const opts = useStackScreenOptions();
  return (
    <ActivityStack.Navigator screenOptions={opts}>
      <ActivityStack.Screen name="ActivityMain" component={ActivityScreen} options={{ title: 'Activity' }} />
      <ActivityStack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ title: 'Detail' }} />
    </ActivityStack.Navigator>
  );
}

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = { Home: '🏠', Chat: '💬', Activity: '📊', Execute: '▶️', Settings: '⚙️' };
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{icons[label] || '•'}</Text>;
}

export default function AppNavigator() {
  const c = useColors();
  const { scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: c.bg,
      card: c.bgElevated,
      text: c.text,
      border: c.border,
      primary: c.accent,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.textMuted,
          tabBarStyle: { backgroundColor: c.bgElevated, borderTopColor: c.border },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Chat" component={ChatNavigator} />
        <Tab.Screen name="Execute" component={ExecuteNavigator} />
        <Tab.Screen name="Activity" component={ActivityNavigator} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

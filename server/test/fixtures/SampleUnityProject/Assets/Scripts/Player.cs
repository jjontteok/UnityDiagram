using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

[RequireComponent(typeof(PlayerInput))]
public class Player : NetworkBehaviour {
    [SerializeField] List<Weapon> weapons;
    [ServerRpc] void AttackServerRpc() { }
}
